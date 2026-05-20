import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { FormField } from '@devvit/shared-types/shared/form.js';

export const menu = new Hono();

const buildNukeFields = (targetId: string): FormField[] => [
  {
    name: 'targetId',
    label: 'Target ID',
    type: 'string',
    helpText: 'Auto-filled from the selected item.',
    required: true,
    defaultValue: targetId,
  },
  {
    name: 'remove',
    label: 'Remove comments',
    type: 'boolean',
    defaultValue: true,
  },
  {
    name: 'lock',
    label: 'Lock comments',
    type: 'boolean',
    defaultValue: false,
  },
  {
    name: 'skipDistinguished',
    label: 'Skip distinguished comments',
    type: 'boolean',
    defaultValue: false,
  },
];

const buildNukeForm = (title: string, targetId: string) => ({
  fields: buildNukeFields(targetId),
  title,
  acceptLabel: 'Mop',
  cancelLabel: 'Cancel',
});

menu.post('/mop-comment', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  console.log('request', request.targetId);
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'mopComment',
        form: buildNukeForm('Mop Comments', request.targetId),
      },
    },
    200
  );
});

menu.post('/mop-post', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'mopPost',
        form: buildNukeForm('Mop Post Comments', request.targetId),
      },
    },
    200
  );
});

menu.post('/vg-review-queue', async (_c) => {
  return _c.json<UiResponse>({
    showForm: {
      name: 'vgReviewQueue',
      form: {
        title: 'Vibe Guard: Review Queue',
        fields: [],
        acceptLabel: 'Load Queue',
        cancelLabel: 'Close',
      },
    },
  });
});

menu.post('/vg-settings', async (_c) => {
  return _c.json<UiResponse>({
    showForm: {
      name: 'vgSettings',
      form: {
        title: 'Vibe Guard: Settings',
        fields: [],
        acceptLabel: 'Show',
        cancelLabel: 'Close',
      },
    },
  });
});

menu.post('/vg-restore-comment', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>({
    showForm: {
      name: 'vgRestoreComment',
      form: {
        title: 'Vibe Guard: Restore Comment',
        description: 'Approve this comment and remove it from the Vibe Guard queue?',
        fields: [
          {
            name: 'commentId',
            label: 'Comment ID',
            type: 'string',
            defaultValue: request.targetId,
            required: true,
          },
        ],
        acceptLabel: 'Restore',
        cancelLabel: 'Cancel',
      },
    },
  });
});

menu.post('/vg-dismiss-item', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>({
    showForm: {
      name: 'vgDismissItem',
      form: {
        title: 'Vibe Guard: Dismiss Item',
        description: 'Mark this item as reviewed and dismiss it from the queue without removing it.',
        fields: [
          {
            name: 'commentId',
            label: 'Content ID',
            type: 'string',
            defaultValue: request.targetId,
            required: true,
          },
        ],
        acceptLabel: 'Dismiss',
        cancelLabel: 'Cancel',
      },
    },
  });
});

menu.post('/vg-confirm-removal', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>({
    showForm: {
      name: 'vgConfirmRemoval',
      form: {
        title: 'Vibe Guard: Confirm Removal',
        description: 'Confirm this comment should be removed and close it from the review queue?',
        fields: [
          {
            name: 'commentId',
            label: 'Comment ID',
            type: 'string',
            defaultValue: request.targetId,
            required: true,
          },
        ],
        acceptLabel: 'Confirm Removal',
        cancelLabel: 'Cancel',
      },
    },
  });
});
