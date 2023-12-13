# we - design

## Overview

![](https://i.imgur.com/ssVZM1E.png)

_We_ is composed of two DNA types:

1. The **group** clonable DNAs, which are responsible for...

- storing the agent's user profile for this _group_
- adding new applets to the _group_

## Group DNA

A We _group_ is an instance of the _group DNA_.

### applets zome

The applets zome is responsible for installing, joining and querying applets of the given _we_ which are stored in the form of `Applet` entries:

```=rust
pub struct Applet {
    // name of the applet as chosen by the person adding it to the group,
    pub custom_name: String,
    pub description: String,
    pub sha256_happ: String,
    pub sha256_ui: Option<String>,
    pub sha256_webhapp: Option<String>,
    pub distribution_info: String,
    pub meta_data: Option<String>,
    pub network_seed: Option<String>,
    pub properties: BTreeMap<String, SerializedBytes>, // Segmented by RoleName
}
```

### profiles zome

The [profiles zome](https://github.com/holochain-open-dev/profiles) is responsible for storing the profiles of the given _we_. An agent has one overarching profile for each instance of a we which will be used by any applet of that _we_.

### peer_status zome

The [peer_status zome](https://github.com/holochain-open-dev/peer-status) adds functionality to see the online status of other agents within the _we_.

### membrane_invitaions zome

The [_membrane invitations_](https://github.com/holochain-open-dev/membrane-invitations) zome offers to send "DNA clone recipes" to other agents which they can then use to install an instance of the DNA in their conductor. It contains the required DNA properties of the form

```=typescript
{
    logo_src: String,
    name: String,
}
```
