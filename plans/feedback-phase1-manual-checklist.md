# Feedback phase 1 manual checklist

Run these checks against the staging worker. The setup steps are in `workers/design-feedback/README.md`.

Start a development Moss with `MOSS_FEEDBACK_WORKER_URL` set to the staging worker URL. Each check names the profile it uses.

## Settings switch

- [ ] Start Moss with a fresh profile that has no groups. Open Settings and find Feedback. Expect the Enable Design Feedback Mode switch to be disabled. Expect the hint text "Feedback becomes available after you join or create a group."
- [ ] Create a group in the same profile. Open Settings again. Expect the switch to be enabled. Expect the line "Reporter id:" followed by an id.

## Dialog validation

- [ ] Turn on Design Feedback Mode and open the feedback dialog. Enter an invalid GitHub username, for example one with spaces. Click outside the field. Expect the Submit button to be disabled. Expect the field to show the red error style.
- [ ] Replace the username with a valid one. Expect the error style to clear. Expect Submit to be enabled once the other required fields are filled.

## Successful submit

- [ ] Submit feedback with a title and a description. Expect the notice "Feedback submitted. GitHub issue created."
- [ ] Open `lightningrodlabs/moss-feedback-staging` on github.com. Expect a new issue created by the app bot user. Expect the issue body to show the reporter line and the marker.
- [ ] Open the feedback history in Moss. Expect the new row to show a View Issue link. Click it. Expect it to open the issue.

## Second profile

- [ ] Start a second Moss profile with its own group. Open Settings and read the reporter id. Expect it to differ from the id of the first profile.
- [ ] Submit feedback from the second profile. Expect the new issue to show the second reporter id.

## Worker unreachable

- [ ] Stop the staging worker, or set `MOSS_FEEDBACK_WORKER_URL` to an address that does not answer. Submit feedback. Expect the notice "Feedback saved locally. Could not reach the feedback service."
- [ ] Open the feedback history. Expect a local record of the submission with no View Issue link.

## Clock skew

- [ ] Set the system clock 10 minutes ahead. Restart Moss. Submit feedback. Expect the notice "Feedback saved locally. Your system clock seems to be off; please check it and try again."
- [ ] Set the clock back to automatic time. Expect the next submission to succeed.
