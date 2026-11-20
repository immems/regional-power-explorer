// The assistant's models through an AI gateway on Cairn (an organisation's AI
// endpoint on, say, the World Bank sandbox), when the build names one:
//
//   VITE_CAIRN_SERVER=https://wb-sandbox.internationalmapping.com
//   VITE_CAIRN_AI_ENDPOINT=<endpoint id or name>   (optional; else the first)
//
// The user signs in with Cairn in a popup; the chat then calls the endpoint with
// their short-lived Cairn token as its key. Cairn checks each call against the
// org's models and limits and adds the org's own credential server-side, so no
// provider key ever reaches this page. Without VITE_CAIRN_SERVER nothing here
// runs and the chat keeps the deployment in config.js.
import { createSyncAuth } from '@imaps/cairn-auth';
import { cairnEndpoint, fetchCairnEndpoints, pickCairnEndpoint } from '@imaps/ai-chat/maplibre';

export const CAIRN_SERVER = import.meta.env.VITE_CAIRN_SERVER || '';
const WANTED_ENDPOINT = import.meta.env.VITE_CAIRN_AI_ENDPOINT || null;

/** One client per page: it keeps the session (sessionStorage) and follows other tabs. */
export const cairnAuth = CAIRN_SERVER ? createSyncAuth({ server: CAIRN_SERVER, storage: 'session', arcgis: false }) : null;

/**
 * The chat's deployment for this session: the chosen endpoint's provider and
 * models, keyed by the session's token. Rejects when the user has no endpoint,
 * with a message fit to show them.
 */
export async function cairnDeployment(session, base) {
  const endpoints = await fetchCairnEndpoints(CAIRN_SERVER, session.token);
  const endpoint = pickCairnEndpoint(endpoints, WANTED_ENDPOINT);
  if (!endpoint) throw new Error('Your account has no AI endpoint on this server. Ask its admin to add you to an organisation that has one.');
  // The org's route is laid over `base` while the user is on it; `base` stays
  // what their own key gets, where the org lets them switch to one.
  return { ...base, ...cairnEndpoint(CAIRN_SERVER, session.token, endpoint, endpoints) };
}

export const sessionLabel = session => session?.user?.name || session?.user?.email || 'signed in';
