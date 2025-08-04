# @KineticCafe/docker-image-update-checker

> This action has been archived. It was originally based on an outdated version
> of [lucacome/docker-image-update-checker][lcdiuc]. That action is now under
> maintenance and should be used instead.

[lcdiuc]: https://github.com/lucacome/docker-image-update-checker

This action checks using the DockerHub API if your `image`, which is based on a
documented `base-image`, needs to be rebuilt to use the most recent version of
your `base-image`.

## Example Usage

This example shows a check for `user/app:latest` against an updated `nginx` base
image for the `linux/amd64` architecture.

```yaml
name: Check docker image for update

on:
  schedule:
    - cron: "0 4 * * *"

jobs:
  docker-update-check:
    runs-on: ubuntu-latest
    steps:
      - uses: KineticCafe/docker-image-update-checker@v1
        id: check
        with:
          base-image: nginx:1.21.0
          image: user/app:latest

      - uses: actions/checkout@v4
        if: steps.check.outputs.needs-update == 'true'

      - uses: docker/build-push-action@5.1.0
        with:
          context: .
          push: true
          tags: user/app:latest
        if: steps.check.outputs.needs-update == 'true'
```

### Multiple Platform Support

This example shows a check for `user/app:latest` against an updated `nginx` base
image for both `linux/amd64` and `linux/arm64`. The `needs-update` flag is set
if any one of the platform abase images requires update.

```yaml
name: Check docker image for update (multiple platforms)

on:
  schedule:
    - cron: "0 4 * * *"

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: KineticCafe/docker-image-update-checker@v1
        id: check
        with:
          base-image: nginx:1.21.0
          image: user/app:latest
          platform: linux/amd64,linux/arm64

  build:
    runs-on: ubuntu-latest
    needs: check
    if: needs.check.outputs.needs-updating == 'true'

    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-qemu-action@v3.0.0
      - uses: docker/setup-buildx-action@v3.1.0

      - uses: docker/build-push-action@5.1.0
        with:
          context: .
          push: true
          tags: user/app:latest
          platforms: |
            linux/amd64
            linux/arm64
```

## Inputs

- `image`: The target docker image for comparison.
- `base-image`: The base docker image to compare against.
- `platforms`: Image platforms to check. Defaults to `linux/amd64`. If _any_ of
  the platforms are not present in either `image` or `base-image`, this action
  will exit with an error.

## Outputs

- `needs-output`: Returns `true` if the `image` needs to be updated because the
  `base-imge` has received an update.

## Debugging

To debug this action, set the `DEBUG` environment variable in the workflow file.
For convenience, `DEBUG` can be set from `${{ secrets.ACTIONS_STEP_DEBUG }}`,
which works even when re-running the action with the `Re-run job` button and
`Enable debug logging`. To read more about debugging actions, see
[Debugging actions][action-debugging].

## Contributing

@KineticCafe/docker-image-update-checker
[welcomes contributions][welcomes contributions]. This project, like all Kinetic
Commerce [open source projects][open source projects], is under the Kinetic
Commerce Open Source [Code of Conduct][Code of Conduct].

This project is licensed under the MIT license and requires certification via a
Developer Certificate of Origin. See [Licence.md][Licence.md] for more details.

## Releasing

Releases are prepared with `@vercel/ncc` to produce a single file which must be
committed to `dist/`. Run `pnpm package` or `pnpm all` to produce this file.

[welcomes contributions]: https://github.com/KineticCafe/docker-image-update-checker/blob/main/Contributing.md
[code of conduct]: https://github.com/KineticCafe/code-of-conduct
[open source projects]: https://github.com/KineticCafe
[licence.md]: https://github.com/KineticCafe/docker-image-update-checker/blob/main/Licence.md
[dco]: https://developercertificate.org
[action-debugging]: https://docs.github.com/en/actions/managing-workflow-runs/enabling-debug-logging#enabling-step-debug-logging
