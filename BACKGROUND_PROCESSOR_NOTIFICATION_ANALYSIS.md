# Background Processor Notification Analysis

## Current Implementation Analysis

After reviewing the example applet code, here's what I found regarding notifications and duplicate implementation:

## 1. Notification Behavior: Applet in Front vs Not Active

### When Applet is IN FRONT (Main View Active):

**Two separate notification mechanisms are active:**

#### A. Background Processor Notifications
- **Location:** `example/ui/index.html` lines 178-248
- **Polling Frequency:**
  - Every **30 seconds** when app is visible AND group is active
  - Every **60 seconds** when resources are constrained
  - Every **2 minutes** when group is not active
  - **Paused** when app is not visible or resources are critical
- **Mechanism:**
  - Polls `getAllPosts()` 
  - Compares post timestamps against `lastSyncTime`
  - Sends notification: `"New Posts"` with count of new posts
  - Updates `lastSyncTime` after notification
- **Notification Details:**
  ```javascript
  {
    title: 'New Posts',
    body: `${newPosts.length} new post(s) available`,
    notification_type: 'new-posts',
    urgency: 'low',
    timestamp: Date.now()
  }
  ```

#### B. PostSummary Component Notifications (Main View)
- **Location:** `example/ui/src/elements/post-summary.ts` lines 46-74
- **Trigger:** When a post is **rendered** in the UI
- **Mechanism:**
  - Uses `PostsStore.allPosts` which polls every **2 seconds** (`lazyLoadAndPoll` with 2000ms interval)
  - When a post is rendered, checks `localStorage.getItem('knownPosts')`
  - If post hash is not in knownPosts, sends notification
  - Adds post hash to localStorage
- **Notification Details:**
  ```javascript
  {
    title: 'New Post',
    body: `Heyho: ${author} created a new Post: "${title}"`,
    notification_type: 'new post',
    urgency: 'high',
    timestamp: entryRecord.action.timestamp
  }
  ```

**Result when applet is in front:** 
- **DUPLICATE NOTIFICATIONS** - Both mechanisms will fire:
  1. Background processor sends "New Posts" (low urgency) every 30 seconds when new posts found
  2. PostSummary sends "New Post" (high urgency) immediately when post appears in UI (triggered by 2-second polling)

### When Applet is NOT ACTIVE (Main View Not Rendered):

**Only Background Processor is active:**

- Main view iframe is destroyed/not rendered
- `PostSummary` component doesn't exist, so no notifications from it
- `PostsStore` polling may or may not be active (depends on iframe lifecycle)
- Background processor continues running in separate iframe
- Polls every **2 minutes** when group not active (or pauses if app not visible)

**Result when applet is not active:**
- **SINGLE NOTIFICATION SOURCE** - Only background processor sends notifications
- User gets notified about new posts even when applet view is not open
- This is the intended behavior for background processing

## 2. Duplicate Implementation Issues

### YES - There is duplicate/overlapping functionality:

#### Duplicate Polling:
1. **Background Processor:** Polls `getAllPosts()` every 30s-2min
2. **PostsStore.allPosts:** Polls `getAllPosts()` every **2 seconds** (via `lazyLoadAndPoll`)

#### Duplicate Notification Logic:
1. **Background Processor:** 
   - Tracks `lastSyncTime` (in-memory variable)
   - Sends aggregated notification: "X new posts available"
   - Updates `lastSyncTime` after notification

2. **PostSummary Component:**
   - Tracks known posts in `localStorage.getItem('knownPosts')`
   - Sends individual notification per post: "Author created a new Post: Title"
   - Updates localStorage after notification

### Problems:

1. **Different tracking mechanisms:**
   - Background processor uses in-memory `lastSyncTime` (resets on reload)
   - PostSummary uses `localStorage` (persists across reloads)
   - These are **not synchronized**, so they can get out of sync

2. **Different notification styles:**
   - Background processor: Aggregated, low urgency
   - PostSummary: Individual, high urgency
   - User may receive both for the same post

3. **Inefficient polling:**
   - PostsStore polls every 2 seconds (very frequent)
   - Background processor polls every 30 seconds
   - Both are calling the same `getAllPosts()` function
   - When applet is in front, this means polling every 2 seconds + every 30 seconds

4. **Race conditions:**
   - If a new post appears:
     - PostSummary might notify first (2-second poll catches it)
     - Background processor might notify 30 seconds later (if it hasn't updated `lastSyncTime` yet)
   - Or vice versa depending on timing

## Recommendations

### Option 1: Disable PostSummary Notifications When Background Processor is Active
- Check if background processor exists
- Only show PostSummary notifications if no background processor
- This prevents duplicates but keeps both mechanisms available

### Option 2: Use Shared State
- Share `lastSyncTime` or `knownPosts` between background processor and main view
- Use a shared storage mechanism (localStorage, IndexedDB, or postMessage)
- Ensure both use the same tracking mechanism

### Option 3: Make Background Processor Primary
- Remove PostSummary notification logic
- Rely entirely on background processor for notifications
- Main view just displays posts (no notification logic)

### Option 4: Differentiate Use Cases
- Background processor: Notifications when applet NOT active (background)
- PostSummary: Notifications when applet IS active (immediate feedback)
- But need to prevent duplicates by sharing state

## Current Code Locations

- **Background Processor:** `example/ui/index.html` lines 178-248
- **PostsStore Polling:** `example/ui/src/posts-store.ts` lines 18-21 (2 second interval)
- **PostSummary Notifications:** `example/ui/src/elements/post-summary.ts` lines 46-74
- **Main View:** `example/ui/src/applet-main.ts` (no polling, just renders UI)

## Summary

**Answer to Question 1:** When applet is in front, users get notifications from BOTH mechanisms (duplicates possible). When not active, only background processor sends notifications.

**Answer to Question 2:** YES, there is duplicate implementation:
- Two separate polling mechanisms (2 seconds vs 30 seconds)
- Two separate notification systems (PostSummary vs Background Processor)
- Two separate tracking mechanisms (localStorage vs in-memory variable)
- Both can fire for the same new post, causing duplicate notifications

