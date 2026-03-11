



export class PermissionHelper {

    

}

export namespace PermissionHelper {

    export enum OrgRoles {
        ADMIN = "ADMIN",
        MAINTAINER = "MAINTAINER",
        DEVELOPER = "DEVELOPER",
        VIEWER = "VIEWER"
    }

    export interface OrgPermissions {

        packages: {
            create: boolean;
            update: boolean;
            delete: boolean;

            releases: {
                publish: boolean;
                update: boolean;
                delete: boolean;

                requestStable: boolean;
            }

            requestTopLevelAlias: boolean;
        }

        members: {
            invite: boolean;
            remove: boolean;
            updateRole: boolean;
        }

        groups: {
            create: boolean;
            update: boolean;
            delete: boolean;
        }

    }

    export const RolePermissions = {

        [OrgRoles.ADMIN]: {
            packages: {
                create: true,
                update: true,
                delete: true,
                releases: {
                    publish: true,
                    update: true,
                    delete: true,
                    requestStable: true
                },
                requestTopLevelAlias: true
            },
            members: {
                invite: true,
                remove: true,
                updateRole: true
            },
            groups: {
                create: true,
                update: true,
                delete: true
            }
        },

        [OrgRoles.MAINTAINER]: {
            packages: {
                create: true,
                update: true,
                delete: false,
                releases: {
                    publish: true,
                    update: true,
                    delete: false,
                    requestStable: true
                },
                requestTopLevelAlias: false
            },
            members: {
                invite: false,
                remove: false,
                updateRole: false
            },
            groups: {
                create: true,
                update: true,
                delete: false
            }
        },

        [OrgRoles.DEVELOPER]: {
            packages: {
                create: true,
                update: false,
                delete: false,
                releases: {
                    publish: true,
                    update: false,
                    delete: false,
                    requestStable: true
                },
                requestTopLevelAlias: false
            },
            members: {
                invite: false,
                remove: false,
                updateRole: false
            },
            groups: {
                create: false,
                update: false,
                delete: false
            }
        },

        [OrgRoles.VIEWER]: {
            packages: {
                create: false,
                update: false,
                delete: false,
                releases: {
                    publish: false,
                    update: false,
                    delete: false,
                    requestStable: false
                },
                requestTopLevelAlias: false
            },
            members: {
                invite: false,
                remove: false,
                updateRole: false
            },
            groups: {
                create: false,
                update: false,
                delete: false
            }
        }
    } as const satisfies Record<OrgRoles, OrgPermissions>;

}
