import { ToolInfoAndLatestVersion } from '../../types.js';

export function createMockToolUpdates(): Record<string, ToolInfoAndLatestVersion> {
    const now = Date.now();
    return {
        'forum-v1': {
            toolInfo: {
                id: 'talkingstickies',
                versionBranch: 'v1',
                title: 'TalkingStickies',
                subtitle: 'Real-time stickies boards',
                description: 'A discussion forum for team collaboration',
                icon: "https://github.com/holochain-apps/talking-stickies/releases/download/v0.12.0-rc.0/talking-stickies_icon.png",
                tags: ["notes", "stickies", "ideation", "boards"],
                versions: [],
                deprecation: undefined,
            },
            latestVersion: {
                version: '0.2.0',
                hashes: {
                    webhappSha256: 'mock-hash-forum',
                    happSha256: 'mock-hash-forum-happ',
                    uiSha256: 'mock-hash-forum-ui',
                },
                url: 'https://example.com/forum.webhapp',
                changelog: '## What\'s New\n\n- 🎨 Added threaded replies\n- 😊 Emoji reactions support\n- 🐛 Bug fixes and improvements',
                releasedAt: now - 2 * 24 * 60 * 60 * 1000, // 2 days ago
            },
            distributionInfo: {
                type: 'web2-tool-list',
                info: {
                    toolListUrl: 'https://example.com/tools.json',
                    developerCollectiveId: 'mock-dev-collective',
                    toolId: 'forum',
                    toolName: 'Forum',
                    versionBranch: 'v1',
                    toolVersion: '0.2.0',
                    toolCompatibilityId: 'forum-v1',
                },
            },
        },
        'kanban-v1': {
            toolInfo: {
                id: 'Kando',
                versionBranch: 'v1',
                title: 'Kando',
                subtitle: 'Real-time KanBan boards',
                description: 'Visual task management with drag-and-drop cards',
                icon: 'https://theweave.social/images/kando_icon.png',
                tags: ["kanban", "project management"],
                versions: [],
                deprecation: undefined,
            },
            latestVersion: {
                version: '1.5.0',
                hashes: {
                    webhappSha256: 'mock-hash-kanban',
                    happSha256: 'mock-hash-kanban-happ',
                    uiSha256: 'mock-hash-kanban-ui',
                },
                url: 'https://example.com/kanban.webhapp',
                changelog: '## Improvements\n\n- ⚡ Performance improvements\n- 🏊 New swimlane view\n- 🎯 Better filtering options',
                releasedAt: now - 5 * 24 * 60 * 60 * 1000, // 5 days ago
            },
            distributionInfo: {
                type: 'web2-tool-list',
                info: {
                    toolListUrl: 'https://example.com/tools.json',
                    developerCollectiveId: 'mock-dev-collective',
                    toolId: 'kanban',
                    toolName: 'Kanban Board',
                    versionBranch: 'v1',
                    toolVersion: '1.5.0',
                    toolCompatibilityId: 'kanban-v1',
                },
            },
        },
        'notebook-v1': {
            toolInfo: {
                id: 'notebooks',
                versionBranch: 'v1',
                title: 'Notebooks',
                subtitle: 'Collaborative MarkDown and Rich Text editor',
                description: 'Rich text notes with markdown support',
                icon: 'https://github.com/lightningrodlabs/notebooks/releases/download/v0.6.0/notebooks_logo.png',
                tags: ["markdown", "real-time editor"],
                versions: [],
                deprecation: undefined,
            },
            latestVersion: {
                version: '2.0.0',
                hashes: {
                    webhappSha256: 'mock-hash-notebook',
                    happSha256: 'mock-hash-notebook-happ',
                    uiSha256: 'mock-hash-notebook-ui',
                },
                url: 'https://example.com/notebook.webhapp',
                changelog: '## Major Update - v2.0\n\n- 📝 Added tables support\n- 💻 Code blocks with syntax highlighting\n- 📐 LaTeX support for math equations\n- 🎨 Improved markdown rendering',
                releasedAt: now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
            },
            distributionInfo: {
                type: 'web2-tool-list',
                info: {
                    toolListUrl: 'https://example.com/tools.json',
                    developerCollectiveId: 'mock-dev-collective',
                    toolId: 'notebook',
                    toolName: 'Notebook',
                    versionBranch: 'v1',
                    toolVersion: '2.0.0',
                    toolCompatibilityId: 'notebook-v1',
                },
            },
        },
    };
}

export function createMockAppletsData(): Record<string, Map<any, any>> {
    return {
        'forum-v1': new Map([
            ['mock-hash-1', {
                applet: { custom_name: 'Team Discussions' },
            }],
            ['mock-hash-2', {
                applet: { custom_name: 'Project Forum' },
            }],
        ]),
        'kanban-v1': new Map([
            ['mock-hash-3', {
                applet: { custom_name: 'Sprint Board' },
            }],
        ]),
        'notebook-v1': new Map(), // No applets using this tool yet
    };
}

export function createMockGroupsData(): Record<string, Map<any, any>> {
    return {
        'forum-v1': new Map([
            ['mock-group-hash-1', {
                name: 'Tennis Club',
                icon: 'https://raw.githubusercontent.com/lightningrodlabs/moss/main/example/ui/tennis_club.png',
            }],
            ['mock-group-hash-2', {
                name: 'Lightningrod Labs',
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNGRjYzNDciLz4KPHBhdGggZD0iTTggMTJDOCAxMC4zNDMxIDkuMzQzMTUgOSAxMSA5QzEyLjY1NjkgOSAxNCA5IDE0IDlDMTUuNjU2OSA5IDE3IDEwLjM0MzEgMTcgMTJDMTcgMTMuNjU2OSAxNS42NTY5IDE1IDE0IDE1QzEyLjM0MzEgMTUgMTEgMTUgMTEgMTVDOS4zNDMxNSAxNSA4IDEzLjY1NjkgOCAxMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=',
            }],
            ['mock-group-hash-3', {
                name: 'Personal',
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNGRkMxMDciLz4KPHBhdGggZD0iTTggMTJDOCAxMC4zNDMxIDkuMzQzMTUgOSAxMSA5QzEyLjY1NjkgOSAxNCA5IDE0IDlDMTUuNjU2OSA5IDE3IDEwLjM0MzEgMTcgMTJDMTcgMTMuNjU2OSAxNS42NTY5IDE1IDE0IDE1QzEyLjM0MzEgMTUgMTEgMTUgMTEgMTVDOS4zNDMxNSAxNSA4IDEzLjY1NjkgOCAxMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=',
            }],
            ['mock-group-hash-4', {
                name: 'Test Group',
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNGRkMxMDciLz4KPHBhdGggZD0iTTggMTJDOCAxMC4zNDMxIDkuMzQzMTUgOSAxMSA5QzEyLjY1NjkgOSAxNCA5IDE0IDlDMTUuNjU2OSA5IDE3IDEwLjM0MzEgMTcgMTJDMTcgMTMuNjU2OSAxNS42NTY5IDE1IDE0IDE1QzEyLjM0MzEgMTUgMTEgMTUgMTEgMTVDOS4zNDMxNSAxNSA4IDEzLjY1NjkgOCAxMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=',
            }],
            ['mock-group-hash-5', {
                name: 'Test Group 2',
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNGRkMxMDciLz4KPHBhdGggZD0iTTggMTJDOCAxMC4zNDMxIDkuMzQzMTUgOSAxMSA5QzEyLjY1NjkgOSAxNCA5IDE0IDlDMTUuNjU2OSA5IDE3IDEwLjM0MzEgMTcgMTJDMTcgMTMuNjU2OSAxNS42NTY5IDE1IDE0IDE1QzEyLjM0MzEgMTUgMTEgMTUgMTEgMTVDOS4zNDMxNSAxNSA4IDEzLjY1NjkgOCAxMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=',
            }],
        ]),
        'kanban-v1': new Map([
            ['mock-group-hash-1', {
                name: 'Tennis Club',
                icon: 'https://raw.githubusercontent.com/lightningrodlabs/moss/main/example/ui/tennis_club.png',
            }],
            ['mock-group-hash-2', {
                name: 'Lightningrod Labs',
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNGRjYzNDciLz4KPHBhdGggZD0iTTggMTJDOCAxMC4zNDMxIDkuMzQzMTUgOSAxMSA5QzEyLjY1NjkgOSAxNCA5IDE0IDlDMTUuNjU2OSA5IDE3IDEwLjM0MzEgMTcgMTJDMTcgMTMuNjU2OSAxNS42NTY5IDE1IDE0IDE1QzEyLjM0MzEgMTUgMTEgMTUgMTEgMTVDOS4zNDMxNSAxNSA4IDEzLjY1NjkgOCAxMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=',
            }],
        ]),
        'notebook-v1': new Map([
            ['mock-group-hash-3', {
                name: 'Tennis Club',
                icon: 'https://raw.githubusercontent.com/lightningrodlabs/moss/main/example/ui/tennis_club.png',
            }],
        ]),
    };
}
