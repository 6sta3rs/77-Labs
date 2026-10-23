# Security and privacy

Seventy Seven Labs is a local voice studio under active development. We do not
claim a security audit, a guaranteed response time, or support for every older
version. Reports should target a recent public commit where possible and
identify the Windows version and engine in use.

## Reporting vulnerabilities

If the public repository offers **Security > Report a vulnerability**, use
private reporting. If that option is disabled, open an issue requesting
a private contact channel, without exploit details or sensitive attachments.
The project does not currently publish a dedicated reporting email address.

Once a private channel is available, provide:

- the commit and versions of the application, engine, and environment;
- a minimal reproduction using fictional data;
- expected behavior, actual impact, and the assessed scope of access;
- a sanitized log or the smallest file needed to reproduce the issue.

Do not send tokens, login files, private recordings, an entire database,
or a full user profile. Ordinary interface bugs can be reported publicly
after removing personal data from the text and screenshots.

How the protections work and what is deliberately not claimed is described in [security architecture](docs/architecture/security.md); what can leave the computer is listed in [privacy](docs/architecture/privacy.md).

## Where data is stored

The default runtime, database, profiles, references, outputs, and some settings
are stored outside the repository in `%LOCALAPPDATA%\VoiceStudioNext`.
Data and model locations can be changed. The interface also uses localStorage
and IndexedDB belonging to the specific browser or WebView profile.
Backups and exports may contain complete recordings and project text.
They are not public test materials.

Do not assume that the database, recordings, or all saved credentials are
encrypted. Protect the Windows account, directory permissions, storage media,
and backups. Deleting an entry in the interface does not promise secure erasure
of a file, cache, backup, or data in an earlier export.

## Network and process boundaries

The supervised local engine uses `127.0.0.1:4312`. A process ownership marker
helps identify the intended backend; it is returned on every response, so it is
not a secret and not an access control, and it does not replace operating-system
account security. The engine accepts browser requests only from the application's
own origins; another process of the same Windows user can still reach the port. Do not expose the port to the Internet. Remote transport,
MCP, and integrations require separate configuration and a permissions review.

Synthesis with models downloaded in advance can run locally. Installing
dependencies and weights requires downloads. A selected LLM, translator,
remote backend, or TTS service may receive text, references, or media.
Check the provider and settings before starting an operation; a local
application does not mean every optional integration stays offline.

Audio/video files, documents, voice packages, and models are external inputs.
Import them from known sources. Dependencies and models may require executing
code; pinning SHA-256 establishes file identity, not safety.

## Updates and releases

The updater verifies a signature with the public key embedded in the application
before it runs an installer. Releases are built by the maintainer and are not
signed with a code-signing certificate, so Windows may show a SmartScreen
warning. Download installers only from this project's GitHub releases and
compare the published SHA-256 file where one is provided.

## Voice and recording consent

Clone your own voice or the voice of a person who has given appropriate consent,
using a recording you have the right to use. Do not publish someone else's
reference in the repository, an issue, or a demo package. An acknowledgment
in the application does not verify identity, grant rights to the material,
or replace model terms.

Do not use generated speech to impersonate someone for fraud. Watermarks
and provenance metadata, where available, do not guarantee detection
of synthetic speech or prove consent.

## Data disclosed in the repository

If a secret is exposed, revoke it with the provider. Removing it from the
current file does not invalidate earlier copies. Limit further publication,
notify the maintainer through a private channel, and identify the commit
and type of exposed data without pasting it again. Cleaning history and
published artifacts requires a separate review; it cannot ensure deletion
of copies already downloaded by others.
