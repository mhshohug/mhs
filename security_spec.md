# Security Specification — Couple Workspaces, Chirkut Box & Cloud Media

## Data Invariants
1. All collections default to `allow read, write: if false;` via global catch-all.
2. **Master Gate (`Workspace`)**: Every `/chirkut_boxes/{boxId}` document has an immutable 2-element `memberUids` array (`uid1 != uid2`), `relationshipType` in `['ex', 'spouse', 'couple']`, and `ownerUid == request.auth.uid` at creation time. Updates and deletes on `/chirkut_boxes/{boxId}` are unconditionally `false`.
3. **Legacy Claim Guard**: Claiming the pre-auth legacy box `box_e9c02e53afeeb0a4010beaff` requires both `isSignedIn()` AND `isAuthorizedWriteToken(legacyClaimPinToken)` plus `!exists(/chirkut_boxes/box_e9c02e53afeeb0a4010beaff)`. Once claimed, only those two registered partner UIDs can ever read or modify its notes, media, or cached lyrics. New couples get a fresh `box_<24hex>` workspace completely isolated from all other accounts.
4. **PII Isolation (`UserWorkspace`)**: `/user_workspaces/{uid}` stores `selfEmail`, `partnerEmail`, `selfName`, `partnerName`, `selfBirthday`, `partnerBirthday` (`YYYY-MM-DD`), and `relationshipType` (`'ex' | 'spouse' | 'couple'`), and is strictly readable (`allow get`) and creatable (`allow create`) ONLY when `request.auth.uid == uid`, `!exists(...)`, and `uid in get(/chirkut_boxes/{boxId}).data.memberUids`. `allow list, update, delete` are `false`.
5. **Subcollection Membership (`notes`, `media`, `song_lyrics`)**: Every read (`get`, `list`) and write (`create`, `update`, `delete`) requires `isBoxMember(boxId)` (Master Gate lookup on `/chirkut_boxes/{boxId}.data.memberUids`). `allow list` also enforces `resource.data.boxId == boxId`.
6. **Legacy Write Token + Workspace Write Token**:
   - Inside `box_e9c02e53afeeb0a4010beaff`, `notes` and `media` writes continue requiring `isAuthorizedWriteToken(pinToken)` in addition to `isBoxMember(boxId)`.
   - Inside newly created couple boxes (`box_<24hex>`), `pinToken` must be a valid 64-char hex SHA-256 token while `isBoxMember(boxId)` enforces UID-level ownership.
7. `ChirkutNote` (`notes/{noteId}`): strict keys (`hasAll` + `hasOnly`), `sender` in `['আমি', 'চাঁদ', 'রুপো']`, bounded `message` (`1..1500`), `createdAt == request.time`, split `edit` vs `soft-delete` updates, hard-delete gated on `existing().status == 'deleted'`.
8. `MediaAsset` (`media/{mediaId}`): strict keys, HTTPS Cloudinary `url`, scoped `publicId`, `sizeBytes` in `1..35000000`, `status == 'active'`, soft-delete transitions only `['status', 'pinToken']`, hard-delete gated on `existing().status == 'deleted'`.

## Dirty Dozen Adversarial Payloads (Must Return `PERMISSION_DENIED`)
1. Reading or listing `/chirkut_boxes/{boxId}/notes` or `/media` while unauthenticated (`request.auth == null`).
2. Signed-in Couple B reading or listing Couple A's `boxId` notes, media, or lyrics.
3. Listing `/chirkut_boxes/{boxId}/media` without `where('boxId', '==', boxId)`.
4. Reading `/user_workspaces/{otherUid}` (PII email scraping) or calling `list` on `/user_workspaces`.
5. Creating `/chirkut_boxes/box_e9c02e53afeeb0a4010beaff` without `legacyClaimPinToken` matching the owner PIN hash.
6. Re-claiming `/chirkut_boxes/box_e9c02e53afeeb0a4010beaff` after it already exists, or updating `memberUids` on any workspace to inject a 3rd user.
7. Creating `/user_workspaces/{victimUid}` as a different user (`request.auth.uid != victimUid`) or linking to a box whose `memberUids` does not include `uid`.
8. Creating a workspace with `memberUids.size() != 2` or duplicate UIDs `[uid1, uid1]`.
9. Path traversal / poisoning in `boxId`, `noteId`, `mediaId`, or `lyricsId` (`../admin`).
10. Creating a `MediaAsset` with a non-Cloudinary URL (`http://evil.com/x.jpg`), `sizeBytes > 35000000`, or ghost field (`isAdmin: true`).
11. Directly calling `deleteDoc` on an active note or `'active'` media document without first setting `status: 'deleted'`.
12. Creating or updating a note/workspace/user-workspace with a forged `createdAt` or `updatedAt` timestamp instead of `request.time`.
