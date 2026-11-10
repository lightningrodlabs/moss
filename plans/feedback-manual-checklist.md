# Feedback manual checklist

Run these checks against the staging worker. The setup steps are in `workers/design-feedback/README.md`.

Start a development Moss with `MOSS_FEEDBACK_WORKER_URL` set to the staging worker URL. Each check names the profile it uses.

# Phase 1

### Settings switch

- [ ] Start Moss with a fresh profile that has no groups. Open Settings and find Feedback. Expect the Enable Design Feedback Mode switch to be enabled. Expect the line "Reporter id:" followed by an id.
- [ ] Create a group in the same profile. Open Settings again. Expect the same reporter id as before.

### Dialog validation

- [ ] Turn on Design Feedback Mode and open the feedback dialog. Enter an invalid GitHub username, for example one with spaces. Click outside the field. Expect the Submit button to be disabled. Expect the field to show the red error style.
- [ ] Replace the username with a valid one. Expect the error style to clear. Expect Submit to be enabled once the other required fields are filled.

### Successful submit

- [ ] Submit feedback with a title and a description. Expect the notice "Feedback submitted. GitHub issue created."
- [ ] Open `lightningrodlabs/moss-feedback-staging` on github.com. Expect a new issue created by the app bot user. Expect the issue body to show the reporter line and the marker.
- [ ] Open the feedback history in Moss. Expect the new row to show a View Issue link. Click it. Expect it to open the issue.

### Second profile

- [ ] Start a second Moss profile with its own group. Open Settings and read the reporter id. Expect it to differ from the id of the first profile.
- [ ] Submit feedback from the second profile. Expect the new issue to show the second reporter id.

### Worker unreachable

- [ ] Stop the staging worker, or set `MOSS_FEEDBACK_WORKER_URL` to an address that does not answer. Submit feedback. Expect the notice "Feedback saved locally. Could not reach the feedback service."
- [ ] Open the feedback history. Expect a local record of the submission with no View Issue link.

### Clock skew

- [ ] Set the system clock 10 minutes ahead. Restart Moss. Submit feedback. Expect the notice "Feedback saved locally. Your system clock seems to be off; please check it and try again."
- [ ] Set the clock back to automatic time. Expect the next submission to succeed.

# Phase 2

### Prerequisites

- [ ] On `lightningrodlabs/moss-feedback-staging`, open Settings, then Webhooks. Expect a repository webhook that points at the staging worker `/v1/webhook` URL, with the issues and issue comments events and a recent delivery that returned 204 or 200.
- [ ] Check that the worker secret `WEBHOOK_SECRET` is set and that migration 0002 is applied to the staging database. Expect a redelivered ping to return 204.
- [ ] Start a development Moss with `MOSS_FEEDBACK_WORKER_URL` set to the staging worker URL. Expect Settings to show the Feedback section as in phase 1.

### Threads and unread

- [ ] File an issue from Moss. Open Settings, then Feedback. Expect the new card under the Open tab with its title and a View on GitHub link.
- [ ] As an org member or collaborator, comment on that issue on GitHub. Within 10 minutes, or as soon as you open Settings and its Feedback tab, expect the card to show the comment with the team style. Expect a badge showing 1 on the settings cog and on the Feedback tab.
- [ ] Move the Moss window out of focus and have the team member comment again. Expect an OS notification. Click it. Expect Moss to come forward with Settings open on the Feedback tab.
- [ ] Expand the card. Expect both badges to clear.
- [ ] As a user who is not a member or collaborator, comment on the issue. Expect the comment to show with the other style and no change to the unread count.
- [ ] Add 10 or more unread team comments across issues. Expect the badge to read `9+`.

### Reply and resolve

- [ ] Type a reply in the card and click Send. Expect the notice "Reply posted." Expect a comment on GitHub that starts with `**Reporter** replied:` followed by the text as a quote. Expect the card to show the reply with the reporter style.
- [ ] Click Mark resolved. Expect the GitHub issue to close as completed, with the comment "Closed as resolved by the reporter from Moss". Expect the card to move to the Closed tab.
- [ ] Open the same profile in a second stale window that still shows the issue as open. Click Mark resolved there. Expect the notice "This issue is already closed."

### Deleted comments and hand-filed issues

- [ ] Delete an unread team comment on GitHub. After the next sync, expect the card to show "Comment deleted" in its place. Expect the badge to drop by one.
- [ ] On the staging repository, file an issue by hand and paste the marker `<!-- moss-feedback reporter=<id> -->` into its body, using the reporter id from Settings. After the next sync, expect the issue to appear under Open.

### Images and failures

- [ ] As a team member, comment `![x](https://example.com/pixel.png)` and then a comment with `<img src="https://example.com/pixel.png">`. Expect links or plain text, never an image, and no request to example.com.
- [ ] Stop the staging worker, or set `MOSS_FEEDBACK_WORKER_URL` to a dead URL, and send a reply. Expect the notice "Could not reach the feedback service. Nothing was sent." Expect the thread and the typed text to stay as they were.

### Visual checks

These were not measured in the running app. Measure them as CLAUDE.md rule 7 says.

- [ ] Badge placement on the settings cog and on the Feedback tab, including the `9+` form. Expect no clipping and no overlap with the label.
- [ ] A card with a very long title or text. Expect an ellipsis and no horizontal scroll.
- [ ] A reporter reply. Expect the quoted text to render as a blockquote.
- [ ] The reply textarea. Expect it to start at three rows and grow with the text.
- [ ] Hover over Mark resolved. Expect a tooltip that says it closes the GitHub issue as completed and cannot be reopened from Moss.
