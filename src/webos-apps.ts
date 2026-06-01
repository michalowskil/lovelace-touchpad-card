import type { WebOSAppConfig } from './types';

export const DEFAULT_WEBOS_APPS: WebOSAppConfig[] = [
  { name: 'Netflix', app_id: 'netflix', icon: 'mdi:netflix' },
  { name: 'Disney+', app_id: 'com.disney.disneyplus-prod', icon: 'mdi:movie-open-star' },
  { name: 'YouTube', app_id: 'youtube.leanback.v4', icon: 'mdi:youtube' },
  { name: 'Prime Video', app_id: 'amazon', icon: 'mdi:play-circle' },
];

export function defaultWebOSAppIcon(name: string, appId: string): string {
  const text = `${name} ${appId}`.toLowerCase();
  if (text.includes('netflix')) return 'mdi:netflix';
  if (text.includes('youtube')) return 'mdi:youtube';
  if (text.includes('disney')) return 'mdi:movie-open-star';
  if (text.includes('prime') || text.includes('amazon')) return 'mdi:play-circle';
  if (text.includes('spotify')) return 'mdi:spotify';
  if (text.includes('plex')) return 'mdi:plex';
  if (text.includes('browser')) return 'mdi:web';
  return 'mdi:apps';
}

export function normalizeWebOSApps(apps: WebOSAppConfig[] | undefined): WebOSAppConfig[] {
  if (!Array.isArray(apps)) {
    return [];
  }

  return apps
    .map((app) => {
      const name = String(app?.name ?? '').trim();
      const appId = String(app?.app_id ?? '').trim();
      const icon = String(app?.icon ?? '').trim();

      return {
        name,
        app_id: appId,
        ...(icon ? { icon } : {}),
      };
    })
    .filter((app) => Boolean(app.app_id && (app.name || app.icon)));
}
