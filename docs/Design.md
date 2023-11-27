# we - design

## Overview

![](https://i.imgur.com/ssVZM1E.png)

*We* is composed of two DNA types:

1. The **group** clonable DNAs, which are responsible for...
  * storing the agent's user profile for this *group*
  * adding new applets to the *group*

## Group DNA

A We *group* is an instance of the *group DNA*.

### applets zome

The applets zome is responsible for installing, joining and querying applets of the given *we* which are stored in the form of `Applet` entries:

```=rust
pub struct Applet {
    // name of the applet as chosen by the person adding it to the group,
    pub custom_name: String,
    pub description: String,

    pub appstore_app_hash: ActionHash,

    pub devhub_dna_hash: DnaHash,
    pub devhub_happ_entry_action_hash: ActionHash,
    pub devhub_happ_release_hash: ActionHash,
    pub initial_devhub_gui_release_hash: Option<ActionHash>,

    pub network_seed: Option<String>,

    pub properties: BTreeMap<String, SerializedBytes>, // Segmented by RoleName
}
```

### profiles zome

The [profiles zome](https://github.com/holochain-open-dev/profiles) is responsible for storing the profiles of the given *we*. An agent has one overarching profile for each instance of a we which will be used by any applet of that *we*.

### peer_status zome

The [peer_status zome](https://github.com/holochain-open-dev/peer-status) adds functionality to see the online status of other agents within the *we*.

### membrane_invitaions zome

The [*membrane invitations*](https://github.com/holochain-open-dev/membrane-invitations) zome offers to send "DNA clone recipes" to other agents which they can then use to install an instance of the DNA in their conductor. It contains the required DNA properties of the form

```=typescript
{
    logo_src: String,
    name: String,
}
```
