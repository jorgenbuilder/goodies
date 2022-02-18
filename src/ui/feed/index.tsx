import React from 'react';
import { useStore } from 'src/store';
import WalletString from 'ui/wallet-string';
import Styles from './Styles.module.css';

export default function Feed () {
    const { cap } = useStore();
    return <div className={Styles.root}>
        {cap.map(([transaction, collection]) => <div key={`tx${collection.principal_id.toText()}${transaction.token || transaction.caller}${transaction.time}`}>
<pre>{collection?.name} #{transaction?.item || transaction.token} {transaction?.price?.value ? <>{transaction.price.value / ( transaction.price.decimals ? 10 ** transaction.price.decimals : 1)}{transaction.price.currency}</> : ''} {transaction.operation} to <WalletString string={transaction.to} /> {transaction.from && <>from <WalletString string={transaction.from} /></>} ({transaction.time.toLocaleDateString()} {transaction.time.toLocaleTimeString()})</pre>
        </div>)}
    </div>
};