# Releasing

Releases are published to npm by GitHub Actions with npm Trusted Publishing, so no npm token is needed. Each release also gets a provenance statement linking it to the commit it was built from.

1. Update the version in both `package.json` and `src/client.ts` (`VERSION`), and add an entry to `CHANGELOG.md`.
2. Commit and push to `main`, and wait for CI to pass.
3. Tag the commit and push the tag:

   ```sh
   git tag v1.2.0
   git push origin v1.2.0
   ```

The `Release` workflow then checks that the tag matches both version numbers and runs `npm publish`, which type-checks, tests and builds before uploading. If any step fails, nothing is published.

## One-time setup

On npmjs.com, open the `copsapi-wrapper` package, go to **Settings**, and under **Trusted Publisher** choose **GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `Matchmaking-Live` |
| Repository | `copsapi-wrapper` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |
