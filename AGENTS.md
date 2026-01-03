## Engineering Discipline

This project expects a high bar for local verification and testability. Changes are only complete once they are proven by local tooling, and tests are written to protect behavior at the unit level.

### Local Verification (Non-Negotiable)
- Always run the linter locally after making edits.
- Always run the full test suite locally after making edits.
- If either fails, fix the issue and run **both** the linter and the full test suite again.

### Testing Expectations
- When implementing a new feature, write tests.
- When fixing a bug, write tests.
- Prefer **unit tests** over broader scopes.
- Avoid editing existing tests unless you must (e.g., the prompt directly contradicts the current test suite or the tests are demonstrably invalid).

### Design for Testability
- Write code that is easy to unit test.
- Keep I/O and network interactions minimal.
- Isolate side effects behind external methods or adapters that are straightforward to mock or substitute in tests.
