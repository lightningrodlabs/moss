# Technical Overview

The social fabric of complex and healthy societies is composed of many interlocking social contracts involving many community subsets.  **The Weave** provides a set of open protocols and standards for spinning up all kinds of small social agreement units and knitting them together in a meaningful and easy to use way.

## Social Substrate

We start with substrate that provides the capacity to instantiate small social-contract units.  

Call the templates for instantiating these units **Social DNAs** or **Rules of Engagement**
Call instances of instantiated Social DNAs **Cells**

### Distributed Context

The specific nature of this substrate is important (see "Considerations" below), but the most critical ones are that:
1. any group of agents that wants to interact according to a Social DNA can do so, i.e. that there is no intermediary enforcing the rules of engagement.
2. any single agent always has full and complete access to any data they contributed to the social context.

These criteria make possible some of most important functional aspects of the Weave as will be described below.

One such substrate that matches these criteria is **Holochain**, which is built out of:
1. a distributed, validating data store (integrity zomes + graphing DHT)
2. with mutation described by clear API (coordinator zomes)
3. where each set of validation rules comprises a separate network of participating agents, co-holding and validating the actions of other agents.


## Typology

Notice that large scale society is build out of many types of these Social DNAs assembled in many ways.  Some of the types include those Social DNAs that can be used to:

1. define "social contexts" i.e. as a membrane to manage membership of individuals into the social context.  These are the the games of "Who".  Call Social DNAs of this type **Membranes**.  Call instances of Membranes **Groups**.
2. define functional components for the group (chat, document editing, KanBan board, drawing).  These are the games of "What". Call Social DNAs of this type **Capacities**.  Call instances of Capacities **Tools**.
3. hold, and make sense of templates, or starting points, which can include SocialDNAs themselves, or initial content for **Capacities**. Call Social DNAs of this type **Sources**.  Call instances of Sources **Libraries**.

## Instantiation & Runtime
Notice that Cells (instances of these DNAs) and the UIs to access them must exist inside some run-time application.  This is similar to how web-sites are accessed using a "web-browser".  Call the type of computer application used to access instances of Membranes, Capacities & Sources (Groups, Tools & Libraries) a **Frame**.  Any Frame will be expected to manage the instantiation and display of these different types of Social DNAs in meaningful ways.

## Composablity
Notice the level of power that arises when Tools are interoperable and composable by end-users.  For example, imagine composing a thread from a chat tool into a document from a collaborative editing tool such that a group's members can converse about documents in context, without having this functionality be added by software developers.  You can think of this as "very-late-binding".  For this to be possible a number conventions and protocols must be adhered to by Frames, just like how web-browsers (Chrome, Firefox or Brave) all adhere to common definitions of HTML, CSS, Javascript, DOM, etc.

Call the conventions around how Cells can be composed and interoperate: the **Weave Interaction Pattern (WIP)**.  The WIP creates standards for the *things* that are managed by the Cells, how to declare and interpret their meaning, how to establish relationships between them, how to create, view and interact with them, how to search for things you know exist, discover new things meaningful to you, and how to help manage attention as things change.

### Things

Abstractly, Capacities provide access to, creation and modification of coherent units of data.  Call such a unit an **Asset**.

### Meaning

As a coherent data unit, an Assets must be interpreted meaningfully.  Assets types are thus defined by:
* <strong>Asset Identifier</strong> definition:  A schema that describes how and asset can be identified, e.g. index, hash, uuid, etc.
* <strong>Asset Semantic Tree</strong> definition: A schema that describes semantically the content of the Asset which can be used to retrieve parts of the Asset, as well as to subscribe to Asset changes.

### Relations

Capacities compose with other Capacities by being able to link to their Assets.  Call a link to an Asset a **Weave Asset Locator (WAL)**.  A WAL is like a URL for the web but is used to identify an Asset.  A WAL consists of a Holochain Resource Locator (HRL) + Asset Identifier.

### Presentation

Capacities define the following UI elements:

1. "Main" renderer: presents contextually relevant UI when an end-user selects the Tool in general instead of a specific Asset created by the Tool.  This rendered will usually include UI to create and administer new Assets.
1. Asset renderer: presents a specific Asset given a WAL.
1. Create renderer: presents UI that can create an Asset of a given type.  Note that a create renderer must collect any appropriate information needed to create the Asset type (i.e. if the asset is a KanBan card, the capacity to specify which board and column in which to add the card).  The create renderer returns a WAL for the created asset, because this renderer may have been activated at the request of a different Tool that wants to store a link the created Asset.
1. "Cross-instance" renderer:  Such renderers are given access to all of the instances of the same Capacity such that they can provide an end-user a unified experience of all of the assets of that abilities type.  For example a calendar Capacity can display all of a user's events across all of their groups in such a renderer.
1. Capacities may include other capacity-specific blocks which are made available to be composable by end-users into views.  Such blocks are useful for creating dashboards.

### Discovery/Search

There are some important distinctions that we start from regarding how we find and find out about things:

* **search**: I know [thing] exists but I don't remember where. I need to *search* for it.
* **discovery**: I'm confronted with a specific need or challenge and am looking for a thing that I don't yet know exists that helps me with that (active discovery). Or I discover something accidentally that I realize (or will remember later) is useful in a context I've been in the past or will be in the future (passive discovery).
* **propagation**: I discovered something useful and want it to propagate to people in similar contexts.

Furthermore we must hold to the truth that information makes sense only in context. These understandings create some mandates in the context of the Weave:

1. searching should respect boundaries
2. context should move with information.
3. information should propagate along axes of contextual similarity

The consequences of these mandates to the WIP are:

- Capacities may define a **Search function**  which implements search across the Assets created by the Tool.  This function is triggered by end-users and is called either with a plain-text search string or with a Sematic Tree Regular Expression, and should return any matching Assets.  Thus, the Frame can always return the context of the found items to the user because it knows which abilities are associated with which groups.
- *Libraries* are available to search for and discover across the range of classes of entities that might exist, i.e. specific information (Assets), functional capacities and their instances (Capacities/Tools), starting points (templates within for addition to specific Tools).
- Capacities may also provide information to the Frame about Asset data that should be indexed for fast searching and propagation. 

### Attention

Members of social contexts need a ways of managing what to pay attention to.  In the "information age" healthy social fabric depends on respecting and supporting the management and awareness of the critical limited resource of our individual attention. 

Thus, abilities can define a set of **Notification Definitions** that end-users can subscribe to.  Frames can then present unified  present UI for setting notification preferences.

### Services

There are often specific types of functions that all Tools in a group may want to access, for example consider sending SMS or email notifications or messages.  This is a kind of functionality that a givThe social fabric of complex and healthy societies is composed of many interlocking social contracts involving many community subsets.  We propose a grammar and implementation of **The Weave**, of a set of open protocols and standards for spinning up all kinds of small social agreement units and knitting them together in a meaningful and easy to use way.
