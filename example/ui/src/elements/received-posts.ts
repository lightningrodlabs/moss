import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '@holochain-open-dev/elements';
import type { SemTreeDataEvent } from '@theweave/api';

interface ReceivedPost {
  title: string;
  content: string;
  sourceAppletId: string;
  topic?: string;
  receivedAt: number;
}

/**
 * Displays posts received from other tool instances via semantic tree pub/sub.
 *
 * Call `addTreeEvent(event)` to feed in SemTreeDataEvent payloads.
 */
@customElement('received-posts')
export class ReceivedPosts extends LitElement {
  @state()
  posts: ReceivedPost[] = [];

  /** Extract title and content from a POST semantic tree event. */
  addTreeEvent(event: SemTreeDataEvent): void {
    const tree = event.tree;
    if (!tree.children || tree.children.length < 2) return;

    // POST tree has TITLE and CONTENT children (order from buildPostTree)
    const title = String(tree.children[0]?.surface ?? '');
    const content = String(tree.children[1]?.surface ?? '');

    this.posts = [
      ...this.posts,
      {
        title,
        content,
        sourceAppletId: event.sourceAppletId,
        topic: event.topic,
        receivedAt: Date.now(),
      },
    ];
  }

  render() {
    if (this.posts.length === 0) {
      return html`
        <div class="column" style="padding: 12px; color: #666; font-style: italic;">
          No posts received from other tools yet. Create a post in the other instance.
        </div>
      `;
    }

    return html`
      <div class="column" style="gap: 8px;">
        ${this.posts.map(
          (post) => html`
            <sl-card>
              <div slot="header" style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${post.title}</strong>
                <span style="font-size: 0.8em; color: #888;">
                  from ${post.sourceAppletId.slice(0, 8)}...
                </span>
              </div>
              <div>${post.content}</div>
            </sl-card>
          `,
        )}
      </div>
    `;
  }

  static styles = [
    css`
      :host {
        display: block;
      }
      sl-card {
        width: 100%;
      }
    `,
    sharedStyles,
  ];
}
