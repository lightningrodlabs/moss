# Background Processor Implementation Notes

## Implementation Status

The background processor proposal has been partially implemented. The following components are in place:

### ✅ Completed

1. **API Extensions**
   - `AppletServices.backgroundProcessor` field added
   - `RenderInfo` type extended with `background-processor` type
   - `BackgroundProcessorLifecycle` interface added
   - `IframeConfig` extended with `groupDnaHash` for background processors

2. **Iframe Support**
   - Background processor renderInfo handling in iframe index.ts
   - Query string parsing for background-processor view type
   - RenderView type extended

3. **Lifecycle Management**
   - `createBackgroundProcessorLifecycle()` function created
   - Tracks app visibility, group active state, and resource state
   - Lifecycle change callbacks supported

4. **Example Applet**
   - Background processor example added to example applet
   - Demonstrates periodic sync with lifecycle-aware throttling
   - Shows notification usage

### ⚠️ Partial / Future Work

1. **Automatic Background Processor Creation**
   - Currently, background processors need to be manually created
   - Future: Automatically create background processor iframes when applets with `backgroundProcessor` are loaded
   - This would require:
     - Detecting when an applet with backgroundProcessor is loaded
     - Creating a hidden iframe for the background processor
     - Executing the background processor function in that iframe

2. **Lifecycle Integration**
   - Group active state tracking needs integration with MossStore
   - Resource state monitoring needs implementation
   - Currently defaults to "normal" state

3. **View Frame Rendering**
   - View-frame.ts can handle background-processor renderViews
   - But background processors should ideally be created as separate hidden iframes
   - Not through the normal view rendering flow

## Testing the Implementation

To test the background processor:

1. **Rebuild the example applet:**
   ```bash
   yarn build:example-applet
   ```

2. **Run in dev mode:**
   ```bash
   yarn applet-dev-example
   ```

3. **Check console logs:**
   - Look for `[Background Processor]` log messages
   - Verify lifecycle changes are detected
   - Check that notifications are sent

## Manual Background Processor Creation

Currently, background processors need to be created manually. To create one:

1. Create a hidden iframe with `view=background-processor` in the query string
2. The iframe will automatically execute the `backgroundProcessor` function from `AppletServices`
3. The processor will run independently of the main view

## Next Steps

1. Implement automatic background processor creation when applets are loaded
2. Integrate lifecycle state with MossStore for accurate group active tracking
3. Implement resource state monitoring
4. Add background processor management UI (optional)

## Notes

- Background processors are designed to be lightweight and persistent
- They continue running even when the main applet view is not rendered
- Lifecycle throttling allows processors to reduce activity when appropriate
- The example applet demonstrates a simple sync pattern with notifications

