# Live Goodies

A browser app for watching Internet Computer NFTs trade in real time, just for fun. Built with cap-js and dab-js.

## Technical Design

What follows is me overthinking things. It might be useful for understanding how this application works.

First, the dependencies. DAB is our metadata directory for all the NFT projects on the IC. CAP is our source of transactions data for all of those NFT projects.

We're just using zustand. As well as what's explained here, there will be a number of other little setters and getters.

### NFT Collections

A list of all NFT canisters along with relevant metadata is fetched from DAB. This is fetched upon initialization, and then checked again every ten minutes.

After fetching the collection of NFT canisters, we query the central CAP canister to find a transaction history canister for each NFT canister. Once an NFT canister initializes one of these CAP "root buckets" it's unlikely to change, so we do not perform this query in instances where an NFT <-> root bucket mapping already exists.

### Transaction Capture

- CAP's API only supports paginated queries.

Transactions are captured by polling the CAP history bucket for each NFT canister. Polling is recursive with a timeout (t ~= 5s) between calls. Each polling event will recurse itself unless it determines that the user has indicated that the corresponding NFT collection is not of interest at this time. When the user indicates that the collection is again of interest, a new polling event is called and recursion begins again.

The transaction data structure has a limited size (n ~= 100) and should be made to be in chronological order at write time (chronology defined as when they were received by this application) so that we have an easily queryable, memory and compute efficient (within the context of this application) snapshot of the current moment in the IC NFT market. Transactions from all collections are stored together in the same structure along with a denormalized instance of the collection they belong to, as this will best support our primary read case. Based on this, the data structure seems to resemble a combination of an evicting queue and a sorted hashmap, which maintains uniqueness, chronology, space efficieny, and queryability.

### Transaction Chronology

Time data retrieved from CAP is unreliable (due in part to time on the IC being somewhat unreliable, and perhaps due to inconsistent implementations by NFT canister developers.) This can manifest itself as transaction events appearing to be from the future when using raw CAP data. As such, we implement our own notion of time using the client system's clock as the authority, and our polling rate as the resolution of time. This will lead to discrepencies in the order of transactions and the specific timing of events between this application and others that use "true CAP time." This is acceptable, however the user facing design of this application should strive not to give an authoritative sense of time.

Chronology based purely on time of receipt introduces a problem of losing certain critical context. After any period of non-polling for any NFT collection, initiating a period of polling will then result in a burst of "false new" transactions from that collection which the application has not seen before. Additionally, because a single structure is shared for all collections, it would be possible for evicted transactions to be recirculated as the data structure loses and finds them repeatedly. We can suppliment the app with a "moment of" timestamp for each history canister to solve both of these issues. A hashmap of history canisters to `moment`s should function like this:

- outside polling `moment` should be `void`
- during polling `moment` will be a `Date()` representing the _CAP timestamp_ of the most recent transaction received from the corresponding canister
- during polling transactions are only captured `moment` is not `void` AND their _CAP timestamp_ is greater than `moment`
- after a polling event, `moment` must always be updated with the newest timestamp from the received request, so long as that timestamp is more recent than the current `moment`
- bursts of false new transactions will not happen because `moment === void` in those cases
- transactions will never be recycled because they would always be `<= moment`