import React from 'react';
import Styles from './Styles.module.css';

export default function WalletString ({ string = '' } : {string : string}) {
    return <span className={Styles.root}>
        {string.slice(0, 5)}...{string.slice(-3)}
    </span>
};