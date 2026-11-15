# Private bare-look discovery and renderer confirmation

Branch: `feat/bare-look-discovery`, based on `ultimate` at `ba939ba`.
Use with Forge's matching branch, based on `ultimate` at `e284cfe`.

## Behavior

Forge wardrobe discovery now retains `bare`, `templateId: body-bare-v1`, output
`sha256`, and `sourceAvatarHash`. A bare library look is offered only in open
Private mode, with `private: true`, a pinned output hash, and a source hash matching
the selected library avatar. Lingerie cannot satisfy an explicit everything-off
request, including when a lingerie look is named.

The downloaded bytes must match the output hash and decode as a VRM with the bare
product tag. Retained tagged garment nodes, meshes, primitives or materials, and
recognized clothing materials, fail verification. Authored anatomical materials
are not treated as clothing just because of their anatomical names.

AvatarManager copies the bare tag from the decoded asset into the loaded root.
The controller requires a verified receipt for the same hash, the expected loaded
URL, the actual root tag, and completion of the outgoing avatar crossfade before
committing the look transaction. Failed confirmation restores the prior outfit
when that failed load is still current. A superseded load cannot roll back a newer
character selection. Existing camera, pose and wardrobe restoration paths remain
in use.

## Operator session boundary

Forge's private inventory and files require its existing `X-Wardrobe-Admin`
operator session. Opening Chatbot Private mode does not supply this authorization.
An authenticated development/operator host can call
`wardrobeService.controller.forge.setAdminSession(sessionToken)` on the configured
Forge client. Obtain the token through the existing Forge sign-in flow; never put
a password or operator token in committed config, a static manifest or browser
storage. Call `setAdminSession(null)` when the host ends the operator session.

The token stays on the client instance in memory. It is sent only for explicitly
private inventory reads or private asset downloads to the configured Forge origin.
Unrelated asset hosts do not receive Forge credentials. Server expiry and logout
continue to invalidate the session. This branch adds no consumer login UI or
delegated end-user authorization service; a production consumer deployment still
needs its approved authorization arrangement rather than a shared operator secret.

## Validation and remaining acceptance

`tests/wardrobe/bare-look-discovery.test.js` covers discovery and exact-source
matching, wardrobe selection, pinned GLB verification and clothing rejection,
operator-header scope, successful renderer confirmation, failure rollback, redress
and superseded-load behavior. It also checks that the bundled clothed AvatarSample
A cannot pass merely by giving it a matching hash.

Validation on this branch: `npm run validate` passed lint, formatting and all
**310 suites / 6,695 tests**. After the final client-origin/redirect handling and
current-Forge selection changes, the affected wardrobe and Private action suites
passed again: **33 suites / 563 tests**. Formatting and `git diff --check` passed.

The test GLBs and manager doubles are plumbing fixtures. They are not a rendered
companion or visual acceptance. No new body/anatomy asset is included. Existing
lingerie screenshots do not establish a bare result.

Before accepting the real flow, supply a complete, clearly adult companion VRM/GLB
licensed for the intended use and containing the required authored detail. Using
an authorized operator session and the paired Forge branch, build and publish its
bare look, restart Forge, then test level-4 discovery, verified rendering, pose
preservation and redress. Also check refusal below the permitted level and when
the bare product is missing. Capture front/back/side/three-quarter QA views of the
same real VRM, with the original and lingerie comparisons, under access control.
Record hashes and actual build/refusal reasons. No mannequin can satisfy this
acceptance step, and no missing anatomical detail is claimed as restored.

No pull request, merge or deployment is part of this branch. Both branches and
real-avatar evidence must be reviewed before any later integration into `ultimate`
or production branches.
