import create from 'zustand';
import { persist } from 'zustand/middleware';
import { getAllNFTS, DABCollection } from '@psychedelic/dab-js';
import { CapRouter, CapRoot, Hosts  } from '@psychedelic/cap-js';
import { Principal } from '@dfinity/principal';
import { parseGetTransactionsResponse, Transaction } from './transactions';

const DAB_UPDATE_INTERVAL = 1000 * 60 * 10;
const TRANSACTION_LIMIT = 100;

const TimeFormatter = new Intl.RelativeTimeFormat('en', { style: 'long' });

const CAP = await CapRouter.init({});

interface Store {

    dab: DABCollection[]
    dabFetch: (force?: boolean) => void;
    dabLastFetch: Date;

    cap: [Transaction, DABCollection][];
    capRoots: { [key : string] : Principal };
    capFetchRoots: () => void;
    pollRootBucket: (tokenCanister : string) => void;

    filters: Principal[];
    filtersAdd: (canisters: Principal[]) => void;
    filtersRemove: (canisters: Principal[]) => void;
    filtersToggle: (canister: Principal) => void;
    filtersReset: () => void;
};

const capPollingMoment : {[key : string] : Date | undefined} = {};
const capIsPolling: {[key : string] : boolean | undefined} = {};

export const useStore = create<Store>(

    persist( // Middleware to persist our store localstorage. NOTE: I dislike this big-wrap syntax.

        (set, get) => ({


            //////////
            // DAB //
            ////////
            // DAB is our directory of all NFT canisters on the IC.


            // Our local list of NFT canisters.
            dab: [],

            // Last DAB update time, so we can throttle updates.
            dabLastFetch: new Date(0),

            // Fetch lastest NFT canister list from DAB.
            // NOTE: Call this from your view to start populating data. I should probably move data initialization into the store.
            dabFetch: (force = false) => {

                // Limit updates to the DAB local collection.
                const { dabLastFetch, capFetchRoots } = get();
                const now = new Date();
                console.info(`Last DAB update: ${TimeFormatter.format((dabLastFetch.getTime() - now.getTime()) / 1000 / 60, 'minutes')}`);
                if (!force && now.getTime() - dabLastFetch.getTime() < DAB_UPDATE_INTERVAL) {
                    console.info(`Skipping DAB sync, last fetch is within acceptable interval.`);
                    return;
                };

                // Fetch latest collection from DAB.
                getAllNFTS().then(collection => {
                    set(state => ({
                        dab: collection.sort((a, b) => a.name < b.name ? -1 : 1), // Let's just sort 'em alphabetically by name for now...
                        dabLastFetch: new Date(),
                    }));
                    // We have all the NFT canisters in our store now, so let's go get the CAP root bucket for each.
                    capFetchRoots();
                });
            },


            //////////
            // CAP //
            ////////
            // CAP is our source of transaction data for each NFT canister.

            // Local list of transactions.
            cap: [],

            // Local map of canister ids to their cap root buckets.
            capRoots: {},

            // Retrieve the root bucket which tracks transactions for each of the available NFT canisters.
            async capFetchRoots () {
                const { dab, capRoots : knownRoots, pollRootBucket } = get();
                const witness = false;
                // Root buckets won't really change in the normal course of action, so if we have a bucket for a canister, we don't need to bother checking again. That will save an IC call per NFT canister, which would add up.
                // NOTE: There doesn't seem to be a bulk query method.
                await Promise.all(
                    // @ts-ignore: different versions of @dfinity/principal in this package, @psychedelic/cap-js and @psychedelic/dab-js...
                    dab.filter(x => !Object.values(knownRoots).includes(x.principal_id))
                    // @ts-ignore: different versions of @dfinity/principal in this package, @psychedelic/cap-js and @psychedelic/dab-js...
                    .map(x => CAP.get_token_contract_root_bucket({ tokenId: x.principal_id, witness })
                        .then(r => ({ [x.principal_id.toText()]: r.canister[0] as Principal | undefined }))
                    )
                ).then((results) => {
                    const capRoots = results.reduce((agg, root) => {
                        if (Object.values(root)[0] === undefined) {
                            return agg;
                        } else {
                            return { ...agg, ...root };
                        };
                    }, knownRoots) as { [key : string] : Principal };
                    set({ capRoots });
                    Object.keys(capRoots).forEach(x => pollRootBucket(x))
                });
            },

            // Start polling for transaction events from the given token canister.
            async pollRootBucket (tokenCanister : string) {
                const { dab, capRoots } = get();
                // @ts-ignore: mismatching agent-js versions... again...
                const collection = dab.find(x => x.principal_id.toText() === tokenCanister) as DABCollection;
                const rootPrincipal = capRoots[tokenCanister];
                if (!rootPrincipal) {
                    console.error(`Can't poll transactions on ${tokenCanister}, root bucket unknown.`);
                    return;
                };

                // We don't want to be polling the same bucket more than once.
                if (capIsPolling[tokenCanister]) return;
                
                // @ts-ignore: typescript definitions for cap-js are just wrong...
                const root = await CapRoot.init({
                    canisterId: rootPrincipal.toText()
                });

                // Recursive polling function
                async function poll () {
                    const { filters } = get();

                    // Query the history canister.
                    const response = await root.get_transactions({ witness: false });
                    const moment = capPollingMoment[tokenCanister];

                    const transactions = (
                        // Parse the whacky canister response into nice javascript objects.
                        parseGetTransactionsResponse(response) as Transaction[]
                    )
                        .reduce<[Transaction, DABCollection][]>((agg, transaction) => {
                            // Filter out transactions that don't have a timestamp.
                            if (transaction?.time === undefined) return agg;

                            // Filter out transactions before the moment
                            if (moment && transaction.time.getTime() <= moment.getTime()) return agg;
                            
                            return [...agg, [transaction, collection]];
                        }, []);

                    const newMoment = transactions[0] ? transactions[0][0].time : moment;

                    if (moment && newMoment && newMoment.getTime() > moment.getTime()) {
                        console.log('Capture!');
                        // Add the newly received transactions to the top of the stack, and trim the stack to N entries
                        set(state => ({ cap: [...transactions, ...state.cap].slice(0, TRANSACTION_LIMIT) }));
                    }
                    capPollingMoment[tokenCanister] = newMoment;
                    if (filters.length === 0 || filters.map(x => x.toText()).includes(tokenCanister)) {
                        // Keep polling
                        setTimeout(poll, 5000);
                    } else {
                        // If the user has indicated they're not interested in this collection, stop polling
                        capPollingMoment[tokenCanister] = undefined;
                    };
                };

                poll();
            },


            //////////////
            // Filters //
            ////////////
            // Filters are a control state that allows filtering down visible data.


            // Empty / default should be assumed to indiciate a "show all" state.
            filters: [],

            // Remove all filters.
            // NOTE: I have a feeling that nesting functions like this is probably inefficient because I'm replacing the parent object, but we're really not calling these parts of the store very often and I like the interface it creates.
            filtersReset() {
                set(state => ({
                    filters: [],
                }));
            },

            // Add canisters to the filter list.
            filtersAdd(canisters: Principal[]) {
                console.info(`Add filters`, canisters);
                set(state => ({
                    filters: [
                        ...state.filters,
                        ...canisters,
                    ],
                }));
            },

            // Remove canisters from the filter list.
            filtersRemove(canisters: Principal[]) {
                console.info(`Remove filters`, canisters);
                set(state => ({
                    filters: state.filters.filter(x => !canisters.includes(x)),
                }));
            },

            // Toggles the state of a single filter.
            filtersToggle(canister: Principal) {
                set(state => {
                    if (state.filters.includes(canister)) {
                        state.filtersRemove([canister]);
                    } else {
                        state.filtersAdd([canister]);
                    };
                });
            },

        }),


        //////////////////
        // Persistence //
        ////////////////


        {
            name: 'goodies-store',

            partialize: state => ({
                dabLastFetch: state.dabLastFetch,
                dab: state.dab,
                cap: state.cap,
                filters: state.filters,
                capRoots: state.capRoots,
            }),
            
            serialize: state => JSON.stringify({
                // @ts-ignore: this middleware has bad type support
                dabLastFetch: state.state.dabLastFetch.getTime(),
                // @ts-ignore: this middleware has bad type support
                dab: state.state.dab,
                // @ts-ignore: this middleware has bad type support
                filters: state.state.filters
            }),

            // @ts-ignore: this middleware has bad type support
            deserialize: state => {
                const data = JSON.parse(state);
                return {
                    dabLastFetch: new Date(data.dabLastFetch),
                    dab: data.dab,
                    filters: data.filters,
                }
            },
        },

    )
);