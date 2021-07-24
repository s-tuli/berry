import {Workspace, structUtils} from '@yarnpkg/core';
import {PortablePath, npath}    from '@yarnpkg/fslib';
import {packUtils}              from '@yarnpkg/plugin-pack';
import {execFile}               from 'child_process';
import {createHash}             from 'crypto';
import ssri                     from 'ssri';
import {URL}                    from 'url';
import {promisify}              from 'util';

const execFilePromise = promisify(execFile);

export async function makePublishBody(workspace: Workspace, buffer: Buffer, {access, tag, registry, gitHead}: {access: string | undefined, tag: string, registry: string, gitHead: string | undefined}) {
  const configuration = workspace.project.configuration;

  const ident = workspace.manifest.name!;
  const version = workspace.manifest.version!;

  const name = structUtils.stringifyIdent(ident);

  const shasum = createHash(`sha1`).update(buffer).digest(`hex`);
  const integrity = ssri.fromData(buffer).toString();

  if (typeof access === `undefined`) {
    if (workspace.manifest.publishConfig && typeof workspace.manifest.publishConfig.access === `string`) {
      access = workspace.manifest.publishConfig.access;
    } else if (configuration.get(`npmPublishAccess`) !== null) {
      access = configuration.get(`npmPublishAccess`)!;
    } else if (ident.scope) {
      access = `restricted`;
    } else {
      access = `public`;
    }
  }

  const raw = await packUtils.genPackageManifest(workspace);

  // This matches Lerna's logic:
  // https://github.com/evocateur/libnpmpublish/blob/latest/publish.js#L142
  // While the npm registry ignores the provided tarball URL, it's used by
  // other registries such as verdaccio.
  const tarballName = `${name}-${version}.tgz`;
  const tarballURL = new URL(`${name}/-/${tarballName}`, registry);

  return {
    _id: name,
    _attachments: {
      [tarballName]: {
        [`content_type`]: `application/octet-stream`,
        data: buffer.toString(`base64`),
        length: buffer.length,
      },
    },
    gitHead,
    name,
    access,

    [`dist-tags`]: {
      [tag]: version,
    },

    versions: {
      [version]: {
        ...raw,

        _id: `${name}@${version}`,

        name,
        version,

        dist: {
          shasum,
          integrity,

          // the npm registry requires a tarball path, but it seems useless 🤷
          tarball: tarballURL.toString(),
        },
      },
    },
  };
}

// This is based on the npm implementation here:
// https://github.com/npm/read-package-json/blob/v3.0.1/read-json.js#L345-L384
export async function getGitHead (workingDir: PortablePath) {
  try {
    const {stdout} = await execFilePromise(`git`, [`rev-parse`, `--revs-only`, `HEAD`], {cwd: npath.fromPortablePath(workingDir)});
    return stdout.trim();
  } catch {
    return undefined;
  }
}
