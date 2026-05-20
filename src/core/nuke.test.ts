import { vi, describe, it, expect, beforeEach } from 'vitest';

const makeMockComment = (overrides?: {
  isDistinguished?: boolean;
  locked?: boolean;
  removed?: boolean;
}) => ({
  id: 't1_child',
  subredditName: 'test_sub',
  isDistinguished: vi.fn().mockReturnValue(overrides?.isDistinguished ?? false),
  replies: { all: vi.fn().mockResolvedValue([]) },
  locked: overrides?.locked ?? false,
  removed: overrides?.removed ?? false,
  lock: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  addRemovalNote: vi.fn().mockResolvedValue(undefined),
});

const mockComment = makeMockComment();

const mockUser = {
  username: 'mod_user',
  getModPermissionsForSubreddit: vi.fn().mockResolvedValue(['all']),
};

const mockPost = {
  id: 't3_post123',
  subredditName: 'test_sub',
  comments: { all: vi.fn().mockResolvedValue([mockComment]) },
};

const mockReddit = vi.hoisted(() => ({
  getCommentById: vi.fn(),
  getCurrentUser: vi.fn(),
  getPostById: vi.fn(),
}));

vi.mock('@devvit/web/server', () => ({
  reddit: mockReddit,
}));

import { handleNuke, handleNukePost } from './nuke';

describe('nuke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReddit.getCurrentUser.mockResolvedValue(mockUser);
    mockReddit.getCommentById.mockResolvedValue(mockComment);
    mockReddit.getPostById.mockResolvedValue(mockPost);
    mockUser.getModPermissionsForSubreddit.mockResolvedValue(['all']);
    mockComment.replies.all.mockResolvedValue([]);
    mockPost.comments.all.mockResolvedValue([mockComment]);
  });

  describe('handleNuke', () => {
    it('removes comments and returns success', async () => {
      const result = await handleNuke({
        remove: true,
        lock: false,
        skipDistinguished: false,
        commentId: 't1_abc' as `t1_${string}`,
        subredditId: 't5_xyz' as `t5_${string}`,
      });

      expect(result.success).toBe(true);
      expect(mockComment.remove).toHaveBeenCalled();
    });

    it('locks comments when lock=true', async () => {
      await handleNuke({
        remove: false,
        lock: true,
        skipDistinguished: false,
        commentId: 't1_abc' as `t1_${string}`,
        subredditId: 't5_xyz' as `t5_${string}`,
      });

      expect(mockComment.lock).toHaveBeenCalled();
    });

    it('returns failure when user has no mod permissions', async () => {
      mockUser.getModPermissionsForSubreddit.mockResolvedValue(['wiki']);

      const result = await handleNuke({
        remove: true,
        lock: false,
        skipDistinguished: false,
        commentId: 't1_abc' as `t1_${string}`,
        subredditId: 't5_xyz' as `t5_${string}`,
      });

      expect(result.success).toBe(false);
      expect(mockComment.remove).not.toHaveBeenCalled();
    });

    it('skips distinguished comments when skipDistinguished=true', async () => {
      const distinguishedComment = makeMockComment({ isDistinguished: true });
      mockReddit.getCommentById.mockResolvedValue(distinguishedComment);

      const result = await handleNuke({
        remove: true,
        lock: false,
        skipDistinguished: true,
        commentId: 't1_abc' as `t1_${string}`,
        subredditId: 't5_xyz' as `t5_${string}`,
      });

      expect(result.success).toBe(true);
      expect(distinguishedComment.remove).not.toHaveBeenCalled();
    });

    it('returns failure when getCurrentUser returns null', async () => {
      mockReddit.getCurrentUser.mockResolvedValue(null);

      const result = await handleNuke({
        remove: true,
        lock: false,
        skipDistinguished: false,
        commentId: 't1_abc' as `t1_${string}`,
        subredditId: 't5_xyz' as `t5_${string}`,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('handleNukePost', () => {
    it('removes all post comments and returns success', async () => {
      const result = await handleNukePost({
        remove: true,
        lock: false,
        skipDistinguished: false,
        postId: 't3_post123' as `t3_${string}`,
        subredditId: 't5_xyz' as `t5_${string}`,
      });

      expect(result.success).toBe(true);
      expect(mockComment.remove).toHaveBeenCalled();
    });

    it('returns failure when user lacks mod permissions', async () => {
      mockUser.getModPermissionsForSubreddit.mockResolvedValue(['flair']);

      const result = await handleNukePost({
        remove: true,
        lock: false,
        skipDistinguished: false,
        postId: 't3_post123' as `t3_${string}`,
        subredditId: 't5_xyz' as `t5_${string}`,
      });

      expect(result.success).toBe(false);
    });
  });
});
