export declare const photoSchema: {
    type: "object";
    properties: {
        id: {
            type: "number";
        };
        folder_id: {
            type: "number";
        };
        filename: {
            type: "string";
        };
        s3_key: {
            type: "string";
        };
        size: {
            type: "number";
        };
        mime_type: {
            type: "string";
        };
        created_at: {
            type: "string";
        };
        modified_at: {
            type: "string";
        };
        thumbnail_path: {
            type: "string";
        };
        metadata_status: {
            type: "string";
        };
        thumbnail_status: {
            type: "string";
        };
        is_favorite: {
            type: "boolean";
        };
        last_synced: {
            type: "string";
        };
        thumbnail_url: {
            type: "string";
        };
        metadata: {
            type: "object";
            properties: {
                width: {
                    type: "number";
                };
                height: {
                    type: "number";
                };
                make: {
                    type: "string";
                };
                model: {
                    type: "string";
                };
                orientation: {
                    type: "number";
                };
                dateTime: {
                    type: "string";
                };
                gps: {
                    type: "object";
                    properties: {
                        latitude: {
                            type: "number";
                        };
                        longitude: {
                            type: "number";
                        };
                        altitude: {
                            type: "number";
                        };
                    };
                };
            };
        };
    };
};
export declare const folderSchema: {
    type: "object";
    properties: {
        id: {
            type: "number";
        };
        path: {
            type: "string";
        };
        name: {
            type: "string";
        };
        parent_id: {
            type: "number";
        };
        created_at: {
            type: "string";
        };
        updated_at: {
            type: "string";
        };
        last_synced: {
            type: "string";
        };
        last_visited: {
            type: "string";
        };
        photo_count: {
            type: "number";
        };
        subfolder_count: {
            type: "number";
        };
        thumbnails_generated: {
            type: "boolean";
        };
        total_size: {
            type: "number";
        };
        folder_created_at: {
            type: "string";
        };
    };
};
export declare const toolSchemas: {
    search_photos: {
        inputSchema: {
            type: "object";
            properties: {
                folder_path: {
                    type: "string";
                    description: string;
                };
                filename: {
                    type: "string";
                    description: string;
                };
                mime_type: {
                    type: "string";
                    description: string;
                };
                is_favorite: {
                    type: "boolean";
                    description: string;
                };
                has_metadata: {
                    type: "boolean";
                    description: string;
                };
                min_size: {
                    type: "number";
                    description: string;
                };
                max_size: {
                    type: "number";
                    description: string;
                };
                date_from: {
                    type: "string";
                    description: string;
                };
                date_to: {
                    type: "string";
                    description: string;
                };
                limit: {
                    type: "number";
                    description: string;
                    default: number;
                };
                offset: {
                    type: "number";
                    description: string;
                    default: number;
                };
            };
        };
        outputSchema: {
            type: "object";
            properties: {
                photos: {
                    type: "array";
                    items: {
                        type: "object";
                        properties: {
                            id: {
                                type: "number";
                            };
                            folder_id: {
                                type: "number";
                            };
                            filename: {
                                type: "string";
                            };
                            s3_key: {
                                type: "string";
                            };
                            size: {
                                type: "number";
                            };
                            mime_type: {
                                type: "string";
                            };
                            created_at: {
                                type: "string";
                            };
                            modified_at: {
                                type: "string";
                            };
                            thumbnail_path: {
                                type: "string";
                            };
                            metadata_status: {
                                type: "string";
                            };
                            thumbnail_status: {
                                type: "string";
                            };
                            is_favorite: {
                                type: "boolean";
                            };
                            last_synced: {
                                type: "string";
                            };
                            thumbnail_url: {
                                type: "string";
                            };
                            metadata: {
                                type: "object";
                                properties: {
                                    width: {
                                        type: "number";
                                    };
                                    height: {
                                        type: "number";
                                    };
                                    make: {
                                        type: "string";
                                    };
                                    model: {
                                        type: "string";
                                    };
                                    orientation: {
                                        type: "number";
                                    };
                                    dateTime: {
                                        type: "string";
                                    };
                                    gps: {
                                        type: "object";
                                        properties: {
                                            latitude: {
                                                type: "number";
                                            };
                                            longitude: {
                                                type: "number";
                                            };
                                            altitude: {
                                                type: "number";
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
                count: {
                    type: "number";
                };
            };
            required: string[];
        };
    };
    get_photo: {
        inputSchema: {
            type: "object";
            properties: {
                photo_id: {
                    type: "number";
                    description: string;
                };
            };
            required: string[];
        };
        outputSchema: {
            type: "object";
            properties: {
                id: {
                    type: "number";
                };
                folder_id: {
                    type: "number";
                };
                filename: {
                    type: "string";
                };
                s3_key: {
                    type: "string";
                };
                size: {
                    type: "number";
                };
                mime_type: {
                    type: "string";
                };
                created_at: {
                    type: "string";
                };
                modified_at: {
                    type: "string";
                };
                thumbnail_path: {
                    type: "string";
                };
                metadata_status: {
                    type: "string";
                };
                thumbnail_status: {
                    type: "string";
                };
                is_favorite: {
                    type: "boolean";
                };
                last_synced: {
                    type: "string";
                };
                thumbnail_url: {
                    type: "string";
                };
                metadata: {
                    type: "object";
                    properties: {
                        width: {
                            type: "number";
                        };
                        height: {
                            type: "number";
                        };
                        make: {
                            type: "string";
                        };
                        model: {
                            type: "string";
                        };
                        orientation: {
                            type: "number";
                        };
                        dateTime: {
                            type: "string";
                        };
                        gps: {
                            type: "object";
                            properties: {
                                latitude: {
                                    type: "number";
                                };
                                longitude: {
                                    type: "number";
                                };
                                altitude: {
                                    type: "number";
                                };
                            };
                        };
                    };
                };
            };
        };
    };
    search_folders: {
        inputSchema: {
            type: "object";
            properties: {
                parent_path: {
                    type: "string";
                    description: string;
                };
                folder_name: {
                    type: "string";
                    description: string;
                };
                has_photos: {
                    type: "boolean";
                    description: string;
                };
                min_photo_count: {
                    type: "number";
                    description: string;
                };
                max_photo_count: {
                    type: "number";
                    description: string;
                };
                limit: {
                    type: "number";
                    description: string;
                    default: number;
                };
                offset: {
                    type: "number";
                    description: string;
                    default: number;
                };
            };
        };
        outputSchema: {
            type: "object";
            properties: {
                folders: {
                    type: "array";
                    items: {
                        type: "object";
                        properties: {
                            id: {
                                type: "number";
                            };
                            path: {
                                type: "string";
                            };
                            name: {
                                type: "string";
                            };
                            parent_id: {
                                type: "number";
                            };
                            created_at: {
                                type: "string";
                            };
                            updated_at: {
                                type: "string";
                            };
                            last_synced: {
                                type: "string";
                            };
                            last_visited: {
                                type: "string";
                            };
                            photo_count: {
                                type: "number";
                            };
                            subfolder_count: {
                                type: "number";
                            };
                            thumbnails_generated: {
                                type: "boolean";
                            };
                            total_size: {
                                type: "number";
                            };
                            folder_created_at: {
                                type: "string";
                            };
                        };
                    };
                };
                count: {
                    type: "number";
                };
            };
            required: string[];
        };
    };
    get_folder: {
        inputSchema: {
            type: "object";
            properties: {
                folder_path: {
                    type: "string";
                    description: string;
                };
            };
            required: string[];
        };
        outputSchema: {
            type: "object";
            properties: {
                id: {
                    type: "number";
                };
                path: {
                    type: "string";
                };
                name: {
                    type: "string";
                };
                parent_id: {
                    type: "number";
                };
                created_at: {
                    type: "string";
                };
                updated_at: {
                    type: "string";
                };
                last_synced: {
                    type: "string";
                };
                last_visited: {
                    type: "string";
                };
                photo_count: {
                    type: "number";
                };
                subfolder_count: {
                    type: "number";
                };
                thumbnails_generated: {
                    type: "boolean";
                };
                total_size: {
                    type: "number";
                };
                folder_created_at: {
                    type: "string";
                };
            };
        };
    };
    get_folder_photos: {
        inputSchema: {
            type: "object";
            properties: {
                folder_path: {
                    type: "string";
                    description: string;
                };
                limit: {
                    type: "number";
                    description: string;
                    default: number;
                };
            };
            required: string[];
        };
        outputSchema: {
            type: "object";
            properties: {
                folder_path: {
                    type: "string";
                };
                photos: {
                    type: "array";
                    items: {
                        type: "object";
                        properties: {
                            id: {
                                type: "number";
                            };
                            folder_id: {
                                type: "number";
                            };
                            filename: {
                                type: "string";
                            };
                            s3_key: {
                                type: "string";
                            };
                            size: {
                                type: "number";
                            };
                            mime_type: {
                                type: "string";
                            };
                            created_at: {
                                type: "string";
                            };
                            modified_at: {
                                type: "string";
                            };
                            thumbnail_path: {
                                type: "string";
                            };
                            metadata_status: {
                                type: "string";
                            };
                            thumbnail_status: {
                                type: "string";
                            };
                            is_favorite: {
                                type: "boolean";
                            };
                            last_synced: {
                                type: "string";
                            };
                            thumbnail_url: {
                                type: "string";
                            };
                            metadata: {
                                type: "object";
                                properties: {
                                    width: {
                                        type: "number";
                                    };
                                    height: {
                                        type: "number";
                                    };
                                    make: {
                                        type: "string";
                                    };
                                    model: {
                                        type: "string";
                                    };
                                    orientation: {
                                        type: "number";
                                    };
                                    dateTime: {
                                        type: "string";
                                    };
                                    gps: {
                                        type: "object";
                                        properties: {
                                            latitude: {
                                                type: "number";
                                            };
                                            longitude: {
                                                type: "number";
                                            };
                                            altitude: {
                                                type: "number";
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
                count: {
                    type: "number";
                };
            };
            required: string[];
        };
    };
    get_folder_tree: {
        inputSchema: {
            type: "object";
            properties: {
                root_path: {
                    type: "string";
                    description: string;
                };
            };
        };
        outputSchema: {
            type: "object";
            properties: {
                root_path: {
                    type: "string";
                };
                folders: {
                    type: "array";
                    items: {
                        type: "object";
                        properties: {
                            id: {
                                type: "number";
                            };
                            path: {
                                type: "string";
                            };
                            name: {
                                type: "string";
                            };
                            parent_id: {
                                type: "number";
                            };
                            created_at: {
                                type: "string";
                            };
                            updated_at: {
                                type: "string";
                            };
                            last_synced: {
                                type: "string";
                            };
                            last_visited: {
                                type: "string";
                            };
                            photo_count: {
                                type: "number";
                            };
                            subfolder_count: {
                                type: "number";
                            };
                            thumbnails_generated: {
                                type: "boolean";
                            };
                            total_size: {
                                type: "number";
                            };
                            folder_created_at: {
                                type: "string";
                            };
                        };
                    };
                };
                count: {
                    type: "number";
                };
            };
            required: string[];
        };
    };
    get_favorite_photos: {
        inputSchema: {
            type: "object";
            properties: {
                limit: {
                    type: "number";
                    description: string;
                    default: number;
                };
            };
        };
        outputSchema: {
            type: "object";
            properties: {
                favorite_photos: {
                    type: "array";
                    items: {
                        type: "object";
                        properties: {
                            id: {
                                type: "number";
                            };
                            folder_id: {
                                type: "number";
                            };
                            filename: {
                                type: "string";
                            };
                            s3_key: {
                                type: "string";
                            };
                            size: {
                                type: "number";
                            };
                            mime_type: {
                                type: "string";
                            };
                            created_at: {
                                type: "string";
                            };
                            modified_at: {
                                type: "string";
                            };
                            thumbnail_path: {
                                type: "string";
                            };
                            metadata_status: {
                                type: "string";
                            };
                            thumbnail_status: {
                                type: "string";
                            };
                            is_favorite: {
                                type: "boolean";
                            };
                            last_synced: {
                                type: "string";
                            };
                            thumbnail_url: {
                                type: "string";
                            };
                            metadata: {
                                type: "object";
                                properties: {
                                    width: {
                                        type: "number";
                                    };
                                    height: {
                                        type: "number";
                                    };
                                    make: {
                                        type: "string";
                                    };
                                    model: {
                                        type: "string";
                                    };
                                    orientation: {
                                        type: "number";
                                    };
                                    dateTime: {
                                        type: "string";
                                    };
                                    gps: {
                                        type: "object";
                                        properties: {
                                            latitude: {
                                                type: "number";
                                            };
                                            longitude: {
                                                type: "number";
                                            };
                                            altitude: {
                                                type: "number";
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
                count: {
                    type: "number";
                };
            };
            required: string[];
        };
    };
    get_recent_photos: {
        inputSchema: {
            type: "object";
            properties: {
                limit: {
                    type: "number";
                    description: string;
                    default: number;
                };
            };
        };
        outputSchema: {
            type: "object";
            properties: {
                recent_photos: {
                    type: "array";
                    items: {
                        type: "object";
                        properties: {
                            id: {
                                type: "number";
                            };
                            folder_id: {
                                type: "number";
                            };
                            filename: {
                                type: "string";
                            };
                            s3_key: {
                                type: "string";
                            };
                            size: {
                                type: "number";
                            };
                            mime_type: {
                                type: "string";
                            };
                            created_at: {
                                type: "string";
                            };
                            modified_at: {
                                type: "string";
                            };
                            thumbnail_path: {
                                type: "string";
                            };
                            metadata_status: {
                                type: "string";
                            };
                            thumbnail_status: {
                                type: "string";
                            };
                            is_favorite: {
                                type: "boolean";
                            };
                            last_synced: {
                                type: "string";
                            };
                            thumbnail_url: {
                                type: "string";
                            };
                            metadata: {
                                type: "object";
                                properties: {
                                    width: {
                                        type: "number";
                                    };
                                    height: {
                                        type: "number";
                                    };
                                    make: {
                                        type: "string";
                                    };
                                    model: {
                                        type: "string";
                                    };
                                    orientation: {
                                        type: "number";
                                    };
                                    dateTime: {
                                        type: "string";
                                    };
                                    gps: {
                                        type: "object";
                                        properties: {
                                            latitude: {
                                                type: "number";
                                            };
                                            longitude: {
                                                type: "number";
                                            };
                                            altitude: {
                                                type: "number";
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
                count: {
                    type: "number";
                };
            };
            required: string[];
        };
    };
    get_gallery_stats: {
        inputSchema: {
            type: "object";
            properties: {};
        };
        outputSchema: {
            type: "object";
            properties: {
                total_photos: {
                    type: "number";
                };
                total_folders: {
                    type: "number";
                };
                total_size: {
                    type: "number";
                };
                favorite_photos: {
                    type: "number";
                };
                photos_with_metadata: {
                    type: "number";
                };
            };
            required: string[];
        };
    };
};
//# sourceMappingURL=schemas.d.ts.map