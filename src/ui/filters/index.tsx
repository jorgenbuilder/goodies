import React from 'react';
import { useStore } from 'src/store';
import Styles from './Styles.module.css';

export default function Filters () {
    const { dab, filters, filtersReset, filtersToggle } = useStore();
    return <div className={Styles.root}>
        <div
            className={[
                Styles.filter,
                filters.length === 0 && Styles.filterActive
            ].join(' ')}
            onClick={filtersReset}
        >All</div>
        {dab.map((canister, i) => <div
            key={`filter${i}`}
            className={[
                Styles.filter,
                filters.find(x => x === canister.principal_id) && Styles.filterActive
            ].join(' ')}
            onClick={() => filtersToggle(canister.principal_id)}
        >
            {canister.name}
        </div>)}
    </div>
};