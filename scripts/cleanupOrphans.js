require('dotenv').config({ quiet: true });

const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');

const Category = require('../src/models/Category');
const Conversation = require('../src/models/Conversation');
const Favorite = require('../src/models/Favorite');
const Listing = require('../src/models/Listing');
const Message = require('../src/models/Message');
const { connectForAudit, runDataAudit, uploadNamespaces } = require('./auditData');

const CONFIRMATION_VALUE = 'DELETE_SCOPED_ORPHANS';
const modelByNamespace = {
  Category,
  Conversation,
  Favorite,
  Listing,
  Message,
};

const getOptions = (argv = process.argv.slice(2)) => ({
  apply: argv.includes('--apply'),
  confirmed: argv.includes(`--confirm=${CONFIRMATION_VALUE}`),
});

const buildPlan = (audit) => ({
  documents: audit.details.orphanDocuments
    .map((item) => ({
      id: item.id,
      namespace: item.namespace,
    }))
    .sort((left, right) => {
      const order = ['Message', 'Conversation', 'Favorite', 'Listing'];
      return order.indexOf(left.namespace) - order.indexOf(right.namespace);
    }),
  files: audit.details.orphanFiles.map((item) => ({
    namespace: item.namespace,
    path: item.path,
  })),
});

const resolveAuditedFilePath = (namespace, publicPath) => {
  if (
    !namespace ||
    typeof publicPath !== 'string' ||
    !publicPath.startsWith(namespace.prefix)
  ) {
    return null;
  }

  const filename = publicPath.slice(namespace.prefix.length);

  if (!filename || filename !== path.basename(filename) || filename.includes('\\')) {
    return null;
  }

  const directory = path.resolve(namespace.directory);
  const diskPath = path.resolve(directory, filename);
  return diskPath.startsWith(`${directory}${path.sep}`) ? diskPath : null;
};

const applyPlan = async (plan) => {
  const deleted = { documents: 0, files: 0 };

  for (const item of plan.documents) {
    const Model = modelByNamespace[item.namespace];

    if (!Model || !mongoose.isValidObjectId(item.id)) {
      continue;
    }

    const result = await Model.deleteOne({ _id: item.id });
    deleted.documents += result.deletedCount || 0;
  }

  for (const item of plan.files) {
    const namespace = uploadNamespaces.find(
      (candidate) => candidate.namespace === item.namespace,
    );
    const diskPath = resolveAuditedFilePath(namespace, item.path);

    if (!diskPath) {
      continue;
    }

    try {
      await fs.unlink(diskPath);
      deleted.files += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return deleted;
};

const main = async () => {
  const options = getOptions();

  if (options.apply && process.env.NODE_ENV !== 'development') {
    console.error('Chỉ cho phép cleanup --apply khi NODE_ENV=development.');
    process.exitCode = 1;
    return;
  }

  if (options.apply && !options.confirmed) {
    console.error(
      `Muốn xóa thật phải thêm --confirm=${CONFIRMATION_VALUE}.`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    await connectForAudit();
    const audit = await runDataAudit();
    const plan = buildPlan(audit);

    if (!options.apply) {
      process.stdout.write(
        `${JSON.stringify({ mode: 'dry-run', plan, summary: audit.summary }, null, 2)}\n`,
      );
      return;
    }

    const deleted = await applyPlan(plan);
    process.stdout.write(`${JSON.stringify({ mode: 'apply', deleted }, null, 2)}\n`);
  } catch (error) {
    console.error(`Cleanup orphan thất bại: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

if (require.main === module) {
  void main();
}

module.exports = {
  CONFIRMATION_VALUE,
  applyPlan,
  buildPlan,
  getOptions,
  resolveAuditedFilePath,
};
