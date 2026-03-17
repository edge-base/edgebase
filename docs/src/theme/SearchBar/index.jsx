import React from 'react';
import { DocsPreferredVersionContextProvider } from '@docusaurus/plugin-content-docs/client';
import SearchBar from './SearchBar';

export default function SearchBarWrapper(props) {
  return (
    <DocsPreferredVersionContextProvider>
      <SearchBar {...props} />
    </DocsPreferredVersionContextProvider>
  );
}
