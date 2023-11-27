use hc_zome_attachments_integrity::*;
use hdk::prelude::holo_hash::DnaHash;
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct Hrl {
    dna_hash: DnaHash,
    resource_hash: AnyDhtHash,
}

#[derive(Serialize, Deserialize, SerializedBytes, Debug, PartialEq)]
pub struct HrlWithContext {
    hrl: Hrl,
    context: SerializedBytes,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AddAttachmentInput {
    hash: AnyDhtHash,
    hrl_with_context: HrlWithContext,
}

#[hdk_extern]
pub fn add_attachment(input: AddAttachmentInput) -> ExternResult<()> {
    create_link(
        input.hash,
        input.hrl_with_context.hrl.resource_hash.clone(),
        LinkTypes::Attachment,
        SerializedBytes::try_from(input.hrl_with_context)
            .map_err(|err| wasm_error!(err))?
            .bytes()
            .clone(),
    )?;

    Ok(())
}

#[hdk_extern]
pub fn get_attachments(hash: AnyDhtHash) -> ExternResult<Vec<HrlWithContext>> {
    let links = get_links(hash, LinkTypes::Attachment, None)?;

    let attachments = links
        .into_iter()
        .map(|link| HrlWithContext::try_from(SerializedBytes::from(UnsafeBytes::from(link.tag.0))))
        .collect::<Result<Vec<HrlWithContext>, SerializedBytesError>>()
        .map_err(|err| wasm_error!(err))?;

    Ok(attachments)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RemoveAttachmentInput {
    hash: AnyDhtHash,
    hrl_with_context: HrlWithContext,
}

#[hdk_extern]
pub fn remove_attachment(input: RemoveAttachmentInput) -> ExternResult<()> {
    let links = get_links(input.hash, LinkTypes::Attachment, None)?;

    let attachment_links: Vec<Link> = links
        .into_iter()
        .filter(|link| {
            let sb = SerializedBytes::from(UnsafeBytes::from(link.tag.0.clone()));
            match HrlWithContext::try_from(sb) {
                Ok(hrl_with_context) => hrl_with_context.eq(&input.hrl_with_context),
                _ => false,
            }
        })
        .collect();

    for attachment_link in attachment_links {
        delete_link(attachment_link.create_link_hash)?;
    }

    Ok(())
}
