# Security Specification — Chirkut Box & Cloud Media (`চিরকুট বক্স ও মিডিয়া`)

## Data Invariants
1. All collections default to `allow read, write: if false;` via global catch-all.
2. Reads (`get`, `list`) and writes on `/chirkut_boxes/{boxId}/notes/{noteId}` and `/chirkut_boxes/{boxId}/media/{mediaId}` require `boxId` matching `isAuthorizedBox(boxId)`.
3. `allow list` strictly evaluates `resource.data.boxId == boxId` so queries cannot cross mailbox boundaries or scrape arbitrary documents.
4. `ChirkutNote` (`notes/{noteId}`):
   - `allow create`: strict key allowlists (`hasAll` + `hasOnly`), `id == noteId`, `boxId == boxId`, `sender` in `['আমি', 'রুপো']`, bounded `message` (`1..1500`), bounded optional `mood` (`1..32`), optional `status == 'active'`, `isAuthorizedWriteToken(pinToken)`, and `createdAt == request.time`.
   - `allow update`: split into two PIN-gated actions (`isAuthorizedWriteToken(incoming().pinToken)` and `incoming().updatedAt == request.time`):
     - **Edit**: active note (`!('status' in existing()) || existing().status == 'active'`) may update only `sender`, `message`, `mood`, `pinToken`, `updatedAt` with immutable `id`, `boxId`, `createdAt`.
     - **Soft-Delete**: active note transitions to `status == 'deleted'` affecting only `status`, `pinToken`, `updatedAt`.
   - `allow delete`: permitted ONLY when `existing().status == 'deleted'` (preventing direct unauthenticated `deleteDoc` on active notes).
5. `MediaAsset` (`media/{mediaId}`):
   - `allow create`: strict key allowlists, `id == mediaId`, `boxId == boxId`, `kind` in `['photo', 'voice', 'song']`, optional `playlistKind` in `['normal', 'birthday']`, bounded strings (`title` `1..120`, optional `subtitle` `1..120`, `dateLabel` `1..60`, `location` `1..80`, `caption` `1..500`), HTTPS Cloudinary `url`, scoped `publicId` (`^vtr/[a-z]+/[a-zA-Z0-9_\-]+$`), `resourceType` in `['image', 'video']`, `sizeBytes` in `1..35000000`, `status == 'active'`, `isAuthorizedWriteToken(pinToken)`, and `createdAt == request.time`.
   - `allow update`: permitted ONLY to mark `status` from `'active'` to `'deleted'`, with `isAuthorizedWriteToken(incoming().pinToken)` and `affectedKeys().hasOnly(['status', 'pinToken'])` so no content fields can be tampered with.
   - `allow delete`: permitted ONLY when `resource.data.status == 'deleted'` (ensuring direct unauthenticated `deleteDoc` on active records fails; deletion requires a PIN-authorized `'active' -> 'deleted'` update first).

## Adversarial Payloads (Must Return `PERMISSION_DENIED`)
1. Reading `/chirkut_boxes/public/notes` or `/chirkut_boxes/public/media` with a guessed `boxId`.
2. Listing `/chirkut_boxes/box_e9c02e53afeeb0a4010beaff/media` without `where('boxId', '==', boxId)`.
3. Creating a note or media record with path traversal in `boxId` / `noteId` / `mediaId` (`../admin`).
4. Creating, editing, or marking-deleted any record with missing or wrong `pinToken`.
5. Creating a media asset with a non-Cloudinary or `http://` URL (e.g., `javascript:alert(1)` or `http://evil.com/x.jpg`).
6. Creating a note or media asset with `status: 'deleted'` initially instead of `'active'`.
7. Creating a media asset with oversized `sizeBytes` (> 35 MB) or extra ghost fields (`isAdmin: true`).
8. Creating or editing a note with a spoofed client `createdAt` or `updatedAt` timestamp instead of `request.time`.
9. Directly calling `deleteDoc` on an active note or `'active'` media document without first completing the PIN-gated `status -> 'deleted'` transition.
10. Updating `url`, `title`, or `kind` on an existing media document, or altering `id`, `boxId`, or `createdAt` on an existing note.
11. Editing a note that is already in terminal `status == 'deleted'`.
