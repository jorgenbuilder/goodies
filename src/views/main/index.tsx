import React from 'react';
import { useStore } from 'src/store';

import Feed from 'ui/feed';
import Filters from 'ui/filters';

import Styles from './Styles.module.css';

export default function MainView() {

    // Fetch DAB when we load this view.
    // Note: I dislike app state logic firing in a view.
    // Note: It seems zustand has not rehydrated state from localstorage by the time this runs, so we always run at least one fetch. Why is that? This would be a bigger problem if I was worried about querying large static datasets.
    const { dabFetch } = useStore();
    React.useEffect(dabFetch, [dabFetch]);

    return <div className={Styles.root}>
        <Filters />
        <Feed />
    </div>;
};