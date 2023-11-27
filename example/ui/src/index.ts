// import "./elements/post-detail.js";
// import "./elements/posts-context.js";

// import {
//   ActionHash,
//   AppAgentClient,
//   CellType,
//   encodeHashToBase64,
//   EntryHash,
// } from "@holochain/client";
// import { html, render, TemplateResult } from "lit";

// import { ProfilesClient, ProfilesStore } from "@holochain-open-dev/profiles";

// import "@holochain-open-dev/profiles/dist/elements/profiles-context.js";
// import "@lightningrodlabs/we-applet/dist/elements/we-services-context.js";
// import "@lightningrodlabs/we-applet/dist/elements/hrl-link.js";

// import {
//   Hrl,
//   AppletViews,
//   CrossAppletViews,
//   WeApplet,
//   AppletClients,
//   WeServices,
// } from "@lightningrodlabs/we-applet";

// import "./applet-main";
// import "./cross-applet-main";
// import { PostsStore } from "./posts-store";
// import { PostsClient } from "./posts-client";

// import {
//   AttachmentsClient,
//   AttachmentsStore,
// } from "@lightningrodlabs/attachments";
// import "@lightningrodlabs/attachments/dist/elements/attachments-context.js";

// import { wrapPathInSvg } from "@holochain-open-dev/elements";
// import { mdiPost } from "@mdi/js";
// import { msg } from "@lit/localize";

// function wrapAppletView(
//   client: AppAgentClient,
//   profilesClient: ProfilesClient,
//   weServices: WeServices,
//   innerTemplate: TemplateResult
// ): TemplateResult {
//   const postsStore = new PostsStore(new PostsClient(client, "forum"));
//   return html`
//     <posts-context .store=${postsStore}>
//       <we-services-context .services=${weServices}>
//         <attachments-context
//           .store=${new AttachmentsStore(new AttachmentsClient(client, "forum"))}
//         >
//           ${innerTemplate}
//         </attachments-context>
//       </we-services-context>
//     </posts-context>
//   `;
// }

// async function appletViews(
//   client: AppAgentClient,
//   appletHash: EntryHash,
//   profilesClient: ProfilesClient,
//   weServices: WeServices
// ): Promise<AppletViews> {
//   return {
//     main: (element) =>
//       render(
//         wrapAppletView(
//           client,
//           profilesClient,
//           weServices,
//           html`
//             <applet-main
//               .client=${client}
//               .weServices=${weServices}
//               @post-selected=${async (e: CustomEvent) => {
//                 const appInfo = await client.appInfo();
//                 const dnaHash = (appInfo.cell_info.forum[0] as any)[
//                   CellType.Provisioned
//                 ].cell_id[0];
//                 weServices.openViews.openHrl([dnaHash, e.detail.postHash], {
//                   detail: "asdf",
//                 });
//               }}
//               @notification=${async (e: CustomEvent) => {
//                 weServices.notifyWe(e.detail);
//               }}
//             ></applet-main>
//           `
//         ),
//         element
//       ),
//     blocks: {},
//     entries: {
//       forum: {
//         posts_integrity: {
//           post: {
//             info: async (hrl: Hrl) => {
//               const postsClient = new PostsClient(client, "forum");

//               const post = await postsClient.getPost(hrl[1]);
//               if (!post) return undefined;

//               return {
//                 name: post.entry.title,
//                 icon_src: wrapPathInSvg(mdiPost),
//               };
//             },
//             view: (element: HTMLElement, hrl: Hrl, context: any) =>
//               render(
//                 wrapAppletView(
//                   client,
//                   profilesClient,
//                   weServices,
//                   html` <post-detail .postHash=${hrl[1]}></post-detail> `
//                 ),
//                 element
//               ),
//           },
//         },
//       },
//     },
//   };
// }

// async function crossAppletViews(
//   applets: ReadonlyMap<EntryHash, AppletClients>, // Segmented by appletHash
//   weServices: WeServices
// ): Promise<CrossAppletViews> {
//   return {
//     main: (element) =>
//       render(
//         html`
//           <we-services-context .services=${weServices}>
//             <cross-applet-main .applets=${applets}></cross-applet-main>
//           </we-services-context>
//         `,
//         element
//       ),
//     blocks: {},
//   };
// }

// const applet: WeApplet = {
//   appletViews,
//   crossAppletViews,
//   attachmentTypes: async (appletClient: AppAgentClient) => ({
//     post: {
//       async create(attachToHrl) {
//         const postsClient = new PostsClient(appletClient, "forum");

//         const post = await postsClient.createPost({
//           title: `Post about hrl://${encodeHashToBase64(
//             attachToHrl[0]
//           )}/${encodeHashToBase64(attachToHrl[1])}`,
//           content: "",
//         });
//         const appInfo = await appletClient.appInfo();
//         const dnaHash = (appInfo.cell_info.forum[0] as any)[
//           CellType.Provisioned
//         ].cell_id[0];

//         return { hrl: [dnaHash, post.actionHash], context: null };
//       },
//       icon_src: wrapPathInSvg(mdiPost),
//       label: msg("Post"),
//     },
//   }),
//   search: async (
//     appletClient: AppAgentClient,
//     _appletHash,
//     _weServices,
//     filter: string
//   ) => {
//     const appInfo = await appletClient.appInfo();
//     const dnaHash = (appInfo.cell_info.forum[0] as any)[CellType.Provisioned]
//       .cell_id[0];

//     const postsClient = new PostsClient(appletClient, "forum");

//     const posts = await postsClient.getAllPosts();

//     const filteredPosts = posts.filter((post) =>
//       post.entry.title.includes(filter)
//     );

//     return filteredPosts.map((p) => ({
//       hrl: [dnaHash, p.actionHash],
//       context: null,
//     }));
//   },
// };

// export default applet;
