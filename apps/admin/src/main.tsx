import React from 'react';
import ReactDOM from 'react-dom/client';
import { Application } from '@punchin/app';
import '@punchin/app/styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Application audience="admin" />
  </React.StrictMode>,
);
