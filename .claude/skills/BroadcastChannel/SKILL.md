```markdown
# BroadcastChannel Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and workflows used in the BroadcastChannel TypeScript codebase. You'll learn about the project's coding conventions, file organization, and how to execute and contribute to key workflows—especially around timeline pagination logic for multi-channel views. This guide also covers testing patterns and provides handy commands for common tasks.

## Coding Conventions

**File Naming**
- Use camelCase for file names.
  - Example: `timelinePagination.ts`, `listComponent.astro`

**Import Style**
- Use relative imports.
  - Example:
    ```typescript
    import { fetchMessages } from './telegram/index';
    ```

**Export Style**
- Use named exports.
  - Example:
    ```typescript
    export function encodeCursor(data: CursorData): string { ... }
    export type Message = { ... };
    ```

**Commit Messages**
- Follow conventional commit style.
  - Prefixes: `fix`
  - Example: `fix: handle cursor edge case`

## Workflows

### Refactor Timeline Pagination Logic
**Trigger:** When you need to fix or enhance the timeline pagination, especially for multi-channel aggregation and cursor management.  
**Command:** `/refactor-pagination`

1. **Update Pagination Logic**
   - Edit `src/lib/telegram/index.ts` to improve how pagination and cursor encoding/decoding are handled.
   - Example:
     ```typescript
     export function encodeCursor(cursor: Cursor): string {
       return Buffer.from(JSON.stringify(cursor)).toString('base64');
     }
     ```
2. **Modify Component and Page Files**
   - Update `src/components/list.astro` and/or `src/pages/after/[cursor].astro`, `src/pages/before/[cursor].astro` to use the new pagination logic.
   - Example:
     ```astro
     ---
     import { fetchPaginatedMessages } from '../../lib/telegram/index';
     const { messages, nextCursor } = await fetchPaginatedMessages(cursor);
     ---
     ```
3. **Update Types**
   - If new cursor formats or types are introduced, update `src/types.ts`.
   - Example:
     ```typescript
     export type Cursor = {
       channelId: string;
       messageId: number;
     };
     ```
4. **Test and Adjust Behavior**
   - Test the homepage (`src/pages/index.astro`) and multi-channel views to ensure pagination works as expected.
   - Manually check edge cases like empty channels or invalid cursors.
5. **Add Fallbacks and Edge-Case Handling**
   - Implement fallback logic for pagination stability in all relevant files.

## Testing Patterns

- **Test File Naming:** Test files use the `*.test.*` pattern.
  - Example: `telegramPagination.test.ts`
- **Testing Framework:** Not explicitly detected; check test files for framework usage.
- **Test Example:**
  ```typescript
  import { encodeCursor } from './index';

  test('encodes cursor correctly', () => {
    const cursor = { channelId: 'abc', messageId: 123 };
    expect(encodeCursor(cursor)).toBe(/* expected value */);
  });
  ```

## Commands

| Command              | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| /refactor-pagination | Refactor and improve timeline pagination logic and stability.   |
```
