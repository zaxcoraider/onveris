import Resolver from '@forge/resolver';
import { NeedsAuthenticationError } from '@forge/api';
import { listProjects, pickIssueType } from '../services/issues.js';
import { getSettings, saveSettings } from '../storage/settings.js';
import { getStatus } from '../services/status.js';

// Handlers for the settings page. This function is wired only to the Jira admin page, which
// Jira shows to administrators alone, and each handler also refuses any other module.

const resolver = new Resolver();

const adminOnly = (handler) => async (request) => {
  try {
    if (request.context?.extension?.type !== 'jira:adminPage') {
      return { ok: false, message: 'Settings can only be changed from Jira administration.' };
    }
    return { ok: true, ...(await handler(request)) };
  } catch (error) {
    // Forge uses this error to ask the user for consent; swallowing it would hide the prompt.
    if (error instanceof NeedsAuthenticationError) throw error;
    console.error(error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
};

const view = async () => {
  const [settings, projects] = await Promise.all([getSettings(), listProjects()]);
  return { driftProject: settings.driftProject, issueType: settings.issueType || null, projects };
};

resolver.define('getSettings', adminOnly(view));

// Live status of the chain endpoints, the checker, Confluence and the Teamwork Graph connector.
resolver.define('getStatus', adminOnly(getStatus));

resolver.define(
  'saveSettings',
  adminOnly(async ({ payload, context }) => {
    const projectId = String(payload?.projectId || '');
    const stamp = { updatedBy: context?.accountId || null, updatedAt: new Date().toISOString() };
    if (!projectId) {
      await saveSettings({ driftProject: null, issueType: null, ...stamp });
      return view();
    }
    const project = (await listProjects()).find((candidate) => candidate.id === projectId);
    if (!project) return { saved: false, message: "Couldn't find that project. Choose one from the list." };
    const issueType = await pickIssueType(project.id);
    if (!issueType) return { saved: false, message: `${project.name} has no issue type Onveris can use. Choose another project.` };
    await saveSettings({ driftProject: project, issueType, ...stamp });
    return view();
  })
);

export const adminHandler = resolver.getDefinitions();
