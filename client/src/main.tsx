import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import RepoListPage from './pages/RepoListPage.js';
import RepoPage from './pages/RepoPage.js';
import './styles.css';

const router = createBrowserRouter([
  { path: '/', element: <RepoListPage /> },
  { path: '/repos/:id', element: <RepoPage /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
