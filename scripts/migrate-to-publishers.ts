#!/usr/bin/env bun
/**
 * Data Migration Script: User-owned packages → Publisher-owned packages
 * 
 * This script helps transition from the old user-based package ownership
 * to the new publisher-based system.
 * 
 * What it does:
 * 1. For each user who owns packages, creates a publisher
 * 2. Adds the user as owner of their publisher
 * 3. Migrates packages to the publisher
 * 4. Updates package names to follow the new naming convention
 * 
 * Usage:
 *   bun run scripts/migrate-to-publishers.ts [--dry-run]
 */

import { DB } from '../src/db';
import { eq, sql } from 'drizzle-orm';
import { PublisherModel } from '../src/api/versions/v1/routes/publishers/model';

const DRY_RUN = process.argv.includes('--dry-run');

interface OldPackage {
    id: number;
    name: string;
    owner_user_id: number;
    description: string;
    homepage_url: string;
    requires_patching: number;
    created_at: number;
    flags: any;
    latest_stable_release: any;
    latest_testing_release: any;
}

interface User {
    id: number;
    username: string;
    display_name: string;
    email: string;
}

async function main() {
    console.log('Starting migration to publisher-based package system...');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be committed)'}\n`);

    // Initialize DB
    await DB.init(process.env.LRA_DB_PATH || './data/db.sqlite', false, './config');

    // Get all packages from old table
    const oldPackages = DB.instance().all(
        sql`SELECT * FROM packages`
    ) as unknown as OldPackage[];

    console.log(`Found ${oldPackages.length} packages to migrate\n`);

    if (oldPackages.length === 0) {
        console.log('No packages to migrate. Exiting.');
        await DB.close();
        return;
    }

    // Group packages by owner
    const packagesByOwner = new Map<number, OldPackage[]>();
    for (const pkg of oldPackages) {
        if (!packagesByOwner.has(pkg.owner_user_id)) {
            packagesByOwner.set(pkg.owner_user_id, []);
        }
        packagesByOwner.get(pkg.owner_user_id)!.push(pkg);
    }

    console.log(`Packages are owned by ${packagesByOwner.size} different users\n`);

    const publisherMap = new Map<number, number>(); // userId -> publisherId

    // Process each owner
    for (const [userId, packages] of packagesByOwner) {
        // Get user info
        const user = await DB.instance()
            .select()
            .from(DB.Tables.users)
            .where(eq(DB.Tables.users.id, userId))
            .get();

        if (!user) {
            console.error(`⚠️  User ${userId} not found, skipping their packages`);
            continue;
        }

        console.log(`Processing user: ${user.username} (${packages.length} packages)`);

        // Create publisher name from username (ensure it's valid)
        let publisherName = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        publisherName = publisherName.replace(/^-+|-+$/g, ''); // remove leading/trailing hyphens
        publisherName = publisherName.replace(/-+/g, '-'); // collapse multiple hyphens

        // Ensure uniqueness
        let finalPublisherName = publisherName;
        let counter = 1;
        while (true) {
            const existing = await DB.instance()
                .select()
                .from(DB.Tables.publishers)
                .where(eq(DB.Tables.publishers.name, finalPublisherName))
                .get();
            
            if (!existing) break;
            
            finalPublisherName = `${publisherName}-${counter}`;
            counter++;
        }

        console.log(`  → Creating publisher: ${finalPublisherName}`);

        if (!DRY_RUN) {
            // Create publisher
            const publisher = await DB.instance()
                .insert(DB.Tables.publishers)
                .values({
                    name: finalPublisherName,
                    display_name: user.display_name || user.username,
                    description: `Personal publisher for ${user.username}`,
                    visibility: 'public',
                    created_by_user_id: userId,
                })
                .returning()
                .get();

            publisherMap.set(userId, publisher.id);

            // Add user as owner
            await DB.instance()
                .insert(DB.Tables.publisherMembers)
                .values({
                    publisher_id: publisher.id,
                    user_id: userId,
                    role: 'owner',
                    permissions: PublisherModel.DefaultPermissions.owner,
                    invited_by_user_id: null,
                });

            // Migrate packages
            for (const pkg of packages) {
                const newPackageName = `${finalPublisherName}.${pkg.name}`;
                
                console.log(`    • Migrating package: ${pkg.name} → ${newPackageName}`);

                // Insert into new packages table (packages_new from migration)
                await DB.instance().run(sql`
                    INSERT INTO packages_new (
                        id, name, publisher_id, group_id, flags, description, 
                        homepage_url, requires_patching, created_at, created_by_user_id,
                        latest_stable_release, latest_testing_release
                    ) VALUES (
                        ${pkg.id}, ${newPackageName}, ${publisher.id}, NULL, ${JSON.stringify(pkg.flags)},
                        ${pkg.description}, ${pkg.homepage_url}, ${pkg.requires_patching},
                        ${pkg.created_at}, ${userId}, ${JSON.stringify(pkg.latest_stable_release)},
                        ${JSON.stringify(pkg.latest_testing_release)}
                    )
                `);
            }
        } else {
            console.log(`  [DRY RUN] Would create publisher and migrate ${packages.length} packages`);
            for (const pkg of packages) {
                console.log(`    • ${pkg.name} → ${finalPublisherName}.${pkg.name}`);
            }
        }

        console.log('');
    }

    if (!DRY_RUN) {
        console.log('\n✅ Migration complete!');
        console.log('\nNext steps:');
        console.log('1. Verify the migrated data in packages_new table');
        console.log('2. Run: DROP TABLE packages;');
        console.log('3. Run: ALTER TABLE packages_new RENAME TO packages;');
        console.log('4. Update Aptly repository if needed');
    } else {
        console.log('\n✅ Dry run complete! Re-run without --dry-run to apply changes.');
    }

    await DB.close();
}

main().catch(console.error);
