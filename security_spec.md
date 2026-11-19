# Security Specification — Chirkut Box (`চিরকুট বক্স`)

## Data Invariants
1. All collections default to `allow read, write: if false;` via global catch-all.
2. Reads (`get`, `list`) and writes (`create`) on `/chirkut_boxes/{boxId}/notes/{noteId}` require a valid `boxId` matching the PIN-derived mailbox key (`isAuthorizedBox(boxId)`).
3. `allow list` strictly evaluates `resource.data.boxId == boxId` so queries cannot cross mailbox boundaries or scrape arbitrary documents.
4. `allow create` enforces strict key allowlists (`hasAll` + `hasOnly`), exact `id == noteId` and `boxId == boxId` integrity, `sender` allowlist (`'আমি'` | `'রুপো'`), bounded `message` (`1..1500` chars), bounded optional `mood` (`1..32` chars), 64-char hex `pinToken` matching the write-PIN SHA-256 token, and server-authoritative `createdAt == request.time`.
5. Notes are append-only (`allow update, delete: if false;`) to prevent tampering or deletion of saved correspondence.

## Dirty Dozen Adversarial Payloads (Must Return `PERMISSION_DENIED`)
1. Reading `/chirkut_boxes/public/notes` with a guessed `boxId`.
2. Listing `/chirkut_boxes/box_e9c02e53afeeb0a4010beaff/notes` where `resource.data.boxId` does not match `{boxId}`.
3. Creating a note with an invalid `boxId` or `noteId` containing path traversal / special chars (`../admin`).
4. Creating a note with missing `pinToken` or wrong `pinToken`.
5. Creating a note with a forged `sender` outside `['আমি', 'রুপো']`.
6. Creating a note with an empty `message` (`""`).
7. Creating a note with an oversized `message` (> 1500 characters).
8. Creating a note with a shadow/ghost field (`{ ..., isAdmin: true }`).
9. Creating a note with a spoofed client `createdAt` timestamp instead of `request.time`.
10. Creating a note where `data.id != noteId`.
11. Updating any existing note (`allow update: if false`).
12. Deleting any existing note (`allow delete: if false`).
