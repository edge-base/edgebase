import { translate } from '@docusaurus/Translate';
import { iconNoResults } from '@easyops-cn/docusaurus-search-local/dist/client/client/theme/SearchBar/icons';
import styles from '@easyops-cn/docusaurus-search-local/dist/client/client/theme/SearchBar/SearchBar.module.css';

export function EmptyTemplate() {
  return `<span class="${styles.noResults}"><span class="${styles.noResultsIcon}">${iconNoResults}</span><span>${translate(
    {
      id: 'theme.SearchBar.noResultsText',
      message: 'No results',
    },
  )}</span></span>`;
}
