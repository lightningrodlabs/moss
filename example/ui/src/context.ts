import { createContext } from '@lit/context';
import { PostsStore } from './posts-store';

export const postsStoreContext = createContext<PostsStore>('hc_zome_posts/store');
