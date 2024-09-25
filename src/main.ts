/**
 * Copyright 2024 Kinetic Commerce and contributors. Based on
 * lucacome/docker-image-update-checker by Luca Comelli.
 *
 * Licensed under the MIT license.
 */

import * as core from '@actions/core'
import ky from 'ky'

import pkg from '../package.json'

const { name: NAME, version: VERSION } = pkg

interface Image {
  input: string
  repo: string
  tag: string | undefined
}

interface Context extends Image {
  token: string
}

const imagePatternRE =
  /(?<repo>[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)(?::(?<tag>\w(?:\w|[-.]){0,127}))/

function parseImageName(input: string): Image {
  const match = input.match(imagePatternRE)

  if (match?.groups == null) {
    throw new Error(`Invalid image name ${input}: must match name[:tag].`)
  }

  const { repo, tag } = match.groups

  if (repo == null) {
    throw new Error(`Invalid image name ${input}: must match name[:tag].`)
  }

  return { input, repo, tag: tag ?? 'latest' }
}

async function getImageAuthToken(image: Image): Promise<string> {
  const res = await ky
    .get('https://auth.docker.io/token', {
      searchParams: {
        service: 'registry.docker.io',
        scope: `repository:${image.repo}:pull`,
      },
    })
    .json()

  if (res && typeof res === 'object' && 'token' in res && typeof res.token === 'string') {
    return res.token
  }

  throw new Error(`Error obtaining pull authorization token for ${image.input}.`)
}

async function buildImageContext(input: string): Promise<Context> {
  const image = parseImageName(input)
  const token = await getImageAuthToken(image)

  const res = await ky.get(`https://index.docker.io/v2/${image.repo}/tags/list`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  if (res.status === 200) {
    return { ...image, token: token }
  }

  if (image.repo.startsWith('library/')) {
    throw new Error(`${image.input} does not exist on DockerHub as ${image.repo}`)
  }

  return buildImageContext(`library/${input}`)
}

interface Manifest {
  digest: string
  platform: string
  tag?: string
}

function resolveErrors(result: object): null | string {
  if ('errors' in result && result.errors != null) {
    if (Array.isArray(result.errors)) {
      const error = result.errors[0]

      if (typeof error === 'object') {
        return ['code', 'message', 'detail']
          .map((v) => ({ name: v, value: error[v] }))
          .filter(({ value }) => value != null)
          .map(({ name, value }) => `  ${name}: ${value}`)
          .join('\n')
      }
    }

    return result.toString()
  }

  return null
}

async function getImageManifests(context: Context): Promise<Manifest[]> {
  const resp = await ky.get(
    `https://index.docker.io/v2/${context.repo}/manifests/${context.tag}`,
    {
      headers: {
        authorization: `Bearer ${context.token}`,
        accept: [
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.oci.image.manifest.v1+json',
        ].join(','),
      },
    },
  )

  const result = await resp.json()

  if (result == null || typeof result !== 'object') {
    throw new Error(`Invalid manifest response for ${context.input}: ${result}`)
  }

  const error = resolveErrors(result)

  if (error) {
    throw new Error(`Manifest error for ${context.input}: ${error}`)
  }

  if (resp.headers.has('docker-content-digest')) {
    const responseDigest = resp.headers.get('docker-content-digest')
    const contentType = resp.headers.get('content-type')

    if (
      responseDigest != null &&
      (contentType === 'application/vnd.docker.distribution.manifest.v2+json' ||
        contentType === 'application/vnd.oci.image.manifest.v1+json')
    ) {
      return [{ digest: responseDigest, platform: 'linux/amd64' }]
    }
  }

  if ('manifests' in result && Array.isArray(result.manifests)) {
    return result.manifests
      .filter((v) => {
        const arch = v.platform?.architecture
        return arch != null && arch !== 'unknown'
      })
      .map((v) => ({
        digest: v.digest,
        platform: `${v.platform?.os}/${v.platform.architecture}`,
      }))
  }

  throw new Error(`Invalid manifest response for ${context.input}: ${result}`)
}

async function getImageLayers(context: Context, digest: string): Promise<Set<string>> {
  const result = await ky
    .get(`https://index.docker.io/v2/${context.repo}/manifests/${digest}`, {
      headers: {
        authorization: `Bearer ${context.token}`,
        accept: [
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.oci.image.manifest.v1+json',
        ].join(','),
      },
    })
    .json()

  if (result == null || typeof result !== 'object') {
    throw new Error(`Invalid layers response for ${context.input}: ${result}`)
  }

  const error = resolveErrors(result)

  if (error) {
    throw new Error(`Manifest error for ${context.input}: ${error}`)
  }

  if ('layers' in result && Array.isArray(result.layers)) {
    return new Set(result.layers.map((v) => v.digest))
  }

  throw new Error(`Invalid layers response for ${context.input}: ${result}`)
}

async function run(): Promise<void> {
  core.info(`${NAME} ${VERSION}`)

  const target = core.getInput('image', { required: true })
  const baseImage = core.getInput('base-image', { required: true })
  const wantedPlatforms = core.getMultilineInput('platforms').flatMap((v) => v.split(','))

  const baseContext = await buildImageContext(baseImage)
  const baseManifests = await getImageManifests(baseContext)

  const targetContext = await buildImageContext(target)
  const targetManifests = await getImageManifests(targetContext)

  let diff = false

  platforms: for (const wanted of wantedPlatforms) {
    const baseDigest = baseManifests.find(({ platform }) => platform === wanted)?.digest

    if (baseDigest == null) {
      throw new Error(`Platform ${wanted} not found in base image ${baseContext.input}.`)
    }

    const targetDigest = targetManifests.find(
      ({ platform }) => platform === wanted,
    )?.digest

    if (targetDigest == null) {
      throw new Error(
        `Platform ${wanted} not found in target image ${targetContext.input}.`,
      )
    }

    const baseLayers = await getImageLayers(baseContext, baseDigest)
    const targetLayers = await getImageLayers(targetContext, targetDigest)

    for (const v of targetLayers.values()) {
      if (!baseLayers.delete(v)) {
        diff = true
        continue platforms
      }
    }

    if (baseLayers.size !== 0) {
      diff = true
    }
  }

  const message = `Image ${targetContext.input} ${diff ? 'has changed' : 'has not changed'}`

  if (process.env.GITHUB_STEP_SUMMARY) {
    core.summary.addHeading(message)
    await core.summary.write()
  } else {
    console.log(message)
  }

  core.setOutput('needs-update', diff)
}

run()
  // eslint-disable-next-line github/no-then
  .then(() => process.exit())
  // eslint-disable-next-line github/no-then
  .catch((error) => core.setFailed(error.message))
