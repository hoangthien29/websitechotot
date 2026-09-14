require('dotenv').config({ quiet: true });

const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/database');
const Category = require('../src/models/Category');
const Conversation = require('../src/models/Conversation');
const Favorite = require('../src/models/Favorite');
const Listing = require('../src/models/Listing');
const Message = require('../src/models/Message');
const User = require('../src/models/User');
const {
  AVATAR_UPLOAD_DIRECTORY,
  AVATAR_UPLOAD_PUBLIC_PREFIX,
  avatarPublicPathToDiskPath,
  isManagedAvatarPath,
} = require('../src/utils/avatarStorage');
const {
  CATEGORY_IMAGE_UPLOAD_DIRECTORY,
  CATEGORY_IMAGE_PUBLIC_PREFIX,
  categoryImagePublicPathToDiskPath,
  isManagedCategoryImagePath,
} = require('../src/utils/categoryImageStorage');
const {
  LISTING_UPLOAD_DIRECTORY,
  LISTING_UPLOAD_PUBLIC_PREFIX,
  isListingImagePublicPath,
  publicPathToDiskPath,
} = require('../src/utils/fileStorage');

const referenceDefinitions = [
  {
    model: Listing,
    namespace: 'Listing',
    references: [
      { field: 'seller', collection: User.collection.name },
      { field: 'category', collection: Category.collection.name },
    ],
  },
  {
    model: Favorite,
    namespace: 'Favorite',
    references: [
      { field: 'user', collection: User.collection.name },
      { field: 'listing', collection: Listing.collection.name },
    ],
  },
  {
    model: Conversation,
    namespace: 'Conversation',
    references: [
      { field: 'listing', collection: Listing.collection.name },
      { field: 'buyer', collection: User.collection.name },
      { field: 'seller', collection: User.collection.name },
    ],
  },
  {
    model: Message,
    namespace: 'Message',
    references: [
      { field: 'conversation', collection: Conversation.collection.name },
      { field: 'sender', collection: User.collection.name },
      { field: 'recipient', collection: User.collection.name },
    ],
  },
];

const uploadNamespaces = [
  {
    directory: LISTING_UPLOAD_DIRECTORY,
    isManagedPath: isListingImagePublicPath,
    namespace: 'listingImages',
    prefix: LISTING_UPLOAD_PUBLIC_PREFIX,
    publicPathToDiskPath,
  },
  {
    directory: AVATAR_UPLOAD_DIRECTORY,
    isManagedPath: isManagedAvatarPath,
    namespace: 'avatars',
    prefix: AVATAR_UPLOAD_PUBLIC_PREFIX,
    publicPathToDiskPath: avatarPublicPathToDiskPath,
  },
  {
    directory: CATEGORY_IMAGE_UPLOAD_DIRECTORY,
    isManagedPath: isManagedCategoryImagePath,
    namespace: 'categoryImages',
    prefix: CATEGORY_IMAGE_PUBLIC_PREFIX,
    publicPathToDiskPath: categoryImagePublicPathToDiskPath,
  },
];

const findBrokenReferences = async ({ model, namespace, references }) => {
  const lookups = references.map((reference) => ({
    $lookup: {
      from: reference.collection,
      localField: reference.field,
      foreignField: '_id',
      as: `_audit_${reference.field}`,
    },
  }));
  const missingExpressions = references.map((reference) => ({
    $cond: [
      { $eq: [{ $size: `$_audit_${reference.field}` }, 0] },
      [reference.field],
      [],
    ],
  }));
  const rows = await model.aggregate([
    ...lookups,
    {
      $project: {
        missingReferences: {
          $concatArrays: missingExpressions,
        },
      },
    },
    { $match: { 'missingReferences.0': { $exists: true } } },
  ]);

  return rows.map((row) => ({
    id: row._id.toString(),
    missingReferences: row.missingReferences,
    namespace,
  }));
};

const fileExists = async (diskPath) => {
  if (!diskPath) {
    return false;
  }

  try {
    await fs.access(diskPath);
    return true;
  } catch {
    return false;
  }
};

const listNamespaceFiles = async ({ directory, prefix }) => {
  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${prefix}${entry.name}`)
    .sort();
};

const getReferencedUploadPaths = async () => {
  const [listings, users, categories] = await Promise.all([
    Listing.find().select('_id images').lean(),
    User.find().select('_id avatar').lean(),
    Category.find().select('_id image').lean(),
  ]);
  const referenced = {
    listingImages: [],
    avatars: [],
    categoryImages: [],
  };
  const invalidManagedPaths = [];

  for (const listing of listings) {
    for (const image of Array.isArray(listing.images) ? listing.images : []) {
      if (isListingImagePublicPath(image)) {
        referenced.listingImages.push(image);
      } else {
        invalidManagedPaths.push({
          id: listing._id.toString(),
          namespace: 'Listing',
          path: String(image),
        });
      }
    }
  }

  for (const user of users) {
    if (!user.avatar) {
      continue;
    }

    if (isManagedAvatarPath(user.avatar)) {
      referenced.avatars.push(user.avatar);
    } else {
      invalidManagedPaths.push({
        id: user._id.toString(),
        namespace: 'User',
        path: String(user.avatar),
      });
    }
  }

  for (const category of categories) {
    if (!category.image) {
      continue;
    }

    if (isManagedCategoryImagePath(category.image)) {
      referenced.categoryImages.push(category.image);
    } else {
      invalidManagedPaths.push({
        id: category._id.toString(),
        namespace: 'Category',
        path: String(category.image),
      });
    }
  }

  return {
    invalidManagedPaths,
    referenced: Object.fromEntries(
      Object.entries(referenced).map(([namespace, values]) => [
        namespace,
        [...new Set(values)].sort(),
      ]),
    ),
  };
};

const auditUploads = async () => {
  const { invalidManagedPaths, referenced } =
    await getReferencedUploadPaths();
  const orphanFiles = [];
  const missingReferencedFiles = [];
  const counts = {};

  for (const uploadNamespace of uploadNamespaces) {
    const namespace = uploadNamespace.namespace;
    const files = await listNamespaceFiles(uploadNamespace);
    const fileSet = new Set(files);
    const referencedSet = new Set(referenced[namespace]);

    for (const publicPath of referencedSet) {
      const diskPath = uploadNamespace.publicPathToDiskPath(publicPath);

      if (!fileSet.has(publicPath) || !(await fileExists(diskPath))) {
        missingReferencedFiles.push({ namespace, path: publicPath });
      }
    }

    for (const publicPath of files) {
      if (!referencedSet.has(publicPath)) {
        orphanFiles.push({ namespace, path: publicPath });
      }
    }

    counts[namespace] = {
      files: files.length,
      referenced: referencedSet.size,
    };
  }

  return {
    counts,
    invalidManagedPaths,
    missingReferencedFiles,
    orphanFiles,
  };
};

const runDataAudit = async () => {
  const orphanDocumentGroups = await Promise.all(
    referenceDefinitions.map(findBrokenReferences),
  );
  const orphanDocuments = orphanDocumentGroups.flat();
  const uploads = await auditUploads();
  const orphanDocumentsByNamespace = Object.fromEntries(
    referenceDefinitions.map(({ namespace }) => [
      namespace,
      orphanDocuments.filter((item) => item.namespace === namespace).length,
    ]),
  );
  const orphanFilesByNamespace = Object.fromEntries(
    uploadNamespaces.map(({ namespace }) => [
      namespace,
      uploads.orphanFiles.filter((item) => item.namespace === namespace)
        .length,
    ]),
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    summary: {
      invalidManagedPaths: uploads.invalidManagedPaths.length,
      missingReferencedFiles: uploads.missingReferencedFiles.length,
      orphanDocuments: {
        byNamespace: orphanDocumentsByNamespace,
        total: orphanDocuments.length,
      },
      orphanFiles: {
        byNamespace: orphanFilesByNamespace,
        total: uploads.orphanFiles.length,
      },
    },
    details: {
      invalidManagedPaths: uploads.invalidManagedPaths,
      missingReferencedFiles: uploads.missingReferencedFiles,
      orphanDocuments,
      orphanFiles: uploads.orphanFiles,
    },
    uploadCounts: uploads.counts,
  };
};

const connectForAudit = async () => {
  await connectDatabase();
};

const main = async () => {
  try {
    await connectForAudit();
    const result = await runDataAudit();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(`Data audit thất bại: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

if (require.main === module) {
  void main();
}

module.exports = {
  auditUploads,
  connectForAudit,
  findBrokenReferences,
  runDataAudit,
  uploadNamespaces,
};
