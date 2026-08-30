import { expect, test } from '@playwright/test'
import { fixtureDirectoryPickerInitScript } from '../src/acceptance/fileSystemAccessFixture'

/**
 * Fixture-backed browser flow. The fake is only the picker boundary: all
 * application code below it runs in Chromium against the real Vite build.
 * Real directory handles and IndexedDB persistence remain manual acceptance.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: fixtureDirectoryPickerInitScript({}, 'playwright-fixture-garden') })
  await page.addInitScript(() => {
    const registrations: Array<{
      tool: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }
      signal: AbortSignal
    }> = []
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool: async (tool: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }, options?: { signal?: AbortSignal }) => {
          registrations.push({ tool, signal: options?.signal ?? new AbortController().signal })
          return undefined
        },
      },
    })
    Object.defineProperty(window, '__researchGardenTools', { configurable: true, value: registrations })
  })
})

async function executeTool(page: import('@playwright/test').Page, name: string, input: object): Promise<any> {
  return page.evaluate(async ({ name: toolName, input: toolInput }) => {
    const registrations = (window as Window & { __researchGardenTools: Array<{ tool: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }; signal: AbortSignal }> }).__researchGardenTools
    const registration = [...registrations].reverse().find(({ tool, signal }) => tool.name === toolName && !signal.aborted)
    if (!registration) throw new Error(`registered tool ${toolName} is unavailable`)
    return registration.tool.execute(toolInput, { signal: new AbortController().signal })
  }, { name, input })
}

async function hasActiveTool(page: import('@playwright/test').Page, name: string): Promise<boolean> {
  return page.evaluate((toolName) => {
    const registrations = (window as Window & { __researchGardenTools: Array<{ tool: { name: string }; signal: AbortSignal }> }).__researchGardenTools
    return [...registrations].reverse().some(({ tool, signal }) => tool.name === toolName && !signal.aborted)
  }, name)
}

test('creates, reads, and edits a Sample Garden through the human interface', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /create garden/i }).click()
  await expect(page.getByRole('tree')).toBeVisible()

  const branch = page.getByRole('treeitem', { name: 'Branch: Deliberate practice' })
  await branch.focus()
  await branch.press('ArrowLeft')
  await expect(page.getByRole('treeitem', { name: /Most of expertise is deliberate practice/i })).toHaveCount(0)
  await branch.press('ArrowRight')
  await branch.press('f')
  await expect(page.getByRole('button', { name: /Focused on Deliberate practice/i })).toBeVisible()
  await branch.press('Escape')
  await expect(page.getByRole('button', { name: /Focused on Deliberate practice/i })).toHaveCount(0)

  const claim = page.getByRole('treeitem', { name: /Most of expertise is deliberate practice/i })
  await claim.focus()
  await claim.press('Enter')
  await expect(page.getByRole('complementary')).toContainText('Expert performance is chiefly')
  await expect(page.locator('[data-relation="contradicts"]')).toHaveCount(1)
  await expect(page.getByRole('treeitem')).toHaveCount(8)

  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.locator('#item-panel-editor')).toBeVisible()
  await page.locator('#item-panel-editor').fill('Edited from the browser human flow.\n')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('complementary')).toContainText('Edited from the browser human flow.')

  const files = await page.evaluate(() => {
    const root = (window as Window & { __researchGardenFixture: { directories: Record<string, { files: Record<string, unknown> }> } }).__researchGardenFixture
    return Object.values(root.directories).flatMap((directory) => Object.keys(directory.files))
  })
  expect(files.filter((name) => name.endsWith('.md'))).toHaveLength(8)
})

test('renders hostile Markdown without executing it or fetching remote media', async ({ page }) => {
  let remoteRequests = 0
  page.on('request', (request) => {
    if (request.url().startsWith('https://evil.example/')) remoteRequests += 1
  })
  await page.goto('/')
  await page.getByRole('button', { name: /create garden/i }).click()
  await expect(page.getByRole('tree')).toBeVisible()
  await page.evaluate(() => {
    const root = (window as Window & { __researchGardenFixture: { directories: Record<string, { kind: 'directory'; name: string; files: Record<string, unknown>; directories: Record<string, unknown> }> } }).__researchGardenFixture
    const branches = root.directories.branches
    if (!branches) throw new Error('Sample Garden branches directory is missing')
    branches.files['safety.md'] = [
          '---',
          'schema_version: 1',
          'id: branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
          'kind: branch',
          'title: Safety note',
          'state: active',
          'created_at: 2026-08-01T10:00:00Z',
          'updated_at: 2026-08-01T10:00:00Z',
          '---',
          '',
          '<script>globalThis.pwned = true</script>',
          '',
          '![tracking pixel](https://evil.example/track.gif)',
          '',
        ].join('\n')
  })
  await page.getByRole('button', { name: /refresh/i }).click()
  const safety = page.getByRole('treeitem', { name: /Safety note/i })
  await safety.focus()
  await safety.press('Enter')

  const panel = page.getByRole('complementary')
  await expect(panel.locator('script')).toHaveCount(0)
  await expect(panel.locator('img')).toHaveCount(0)
  await expect(panel.locator('a[href="https://evil.example/track.gif"]')).toHaveCount(1)
  expect(await page.evaluate(() => (window as Window & { pwned?: boolean }).pwned)).toBeUndefined()
  expect(remoteRequests).toBe(0)

})

test('runs registered WebMCP tools through Change Tray approval, rejection, and Activity', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /create garden/i }).click()
  await expect(page.getByRole('tree')).toBeVisible()
  await page.getByRole('button', { name: /Connect ChatGPT/i }).click()
  await page.getByRole('button', { name: /Enable Agent Access/i }).click()
  await expect.poll(() => hasActiveTool(page, 'find_contradictions')).toBe(true)
  const toolBranch = page.getByRole('treeitem', { name: 'Branch: Deliberate practice' })
  await toolBranch.focus()
  await toolBranch.press('f')
  await expect(page.getByRole('button', { name: /Focused on Deliberate practice/i })).toBeVisible()
  await expect.poll(() => hasActiveTool(page, 'propose_harvest')).toBe(true)

  const contradiction = await executeTool(page, 'find_contradictions', {})
  expect(contradiction.ok).toBe(true)
  const pair = contradiction.data.pairs[0]
  const questions = await executeTool(page, 'find_open_questions', {})
  const proposedInput = {
    title: 'Browser approved Harvest',
    parentId: pair.claimA.parentId,
    supportedBy: [...new Set([...pair.supportingRootsA, ...pair.supportingRootsB].map((root: { itemId: string }) => root.itemId))],
    claimIds: [pair.claimA.itemId, pair.claimB.itemId],
    questionId: questions.data.questions[0].itemId,
    question: 'Which account best explains the contradiction?',
    synthesis: 'The claims remain in tension and should both remain visible.',
    evidence: 'Both claims and their Roots are present in the fixture Garden.',
    contradictionsAndUncertainty: 'The supported Claims disagree; the evidence does not justify choosing one as universally correct.',
    openQuestions: 'What additional evidence would resolve this uncertainty?',
  }
  const firstProposal = await executeTool(page, 'propose_harvest', proposedInput)
  expect(firstProposal.ok).toBe(true)
  await expect(page.getByRole('button', { name: '1 Change' })).toBeVisible()
  await page.getByRole('button', { name: '1 Change' }).click()
  await expect(page.getByRole('complementary', { name: 'Pending Change' })).toContainText('Browser approved Harvest')
  await expect(page.getByRole('region', { name: 'Change Tray' })).toContainText('1 change to review')
  await expect(page.locator('.change-diff')).toContainText('Browser approved Harvest')
  await expect(page.locator('.change-diff__line--added').filter({ hasText: 'Browser approved Harvest' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('button', { name: /Change/ })).toHaveCount(0)

  await page.getByRole('button', { name: /Activity/ }).click()
  const activity = page.getByRole('complementary', { name: 'Garden Activity' })
  await expect(activity).toContainText('Propose Harvest')
  await expect(activity).toContainText('Approve succeeded')

  const secondProposal = await executeTool(page, 'propose_harvest', { ...proposedInput, title: 'Browser rejected Harvest' })
  expect(secondProposal.ok).toBe(true)
  await expect(page.getByRole('button', { name: '1 Change' })).toBeVisible()
  await page.getByRole('button', { name: '1 Change' }).click()
  await expect(page.getByRole('complementary', { name: 'Pending Change' })).toContainText('Browser rejected Harvest')
  await expect(page.locator('.change-diff')).toContainText('Browser rejected Harvest')
  await expect(page.locator('.change-diff__line--added').filter({ hasText: 'Browser rejected Harvest' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByRole('button', { name: /Change/ })).toHaveCount(0)
  await page.getByRole('button', { name: /Activity/ }).click()
  await expect(page.getByRole('complementary', { name: 'Garden Activity' })).toContainText('Reject succeeded')

  // Disconnect aborts every signal owned by the state-aware registration;
  // stale tool objects therefore cannot be selected by executeTool.
  await page.getByRole('button', { name: 'Disconnect ChatGPT' }).click()
  const activeAfterDisconnect = await page.evaluate(() => {
    const registrations = (window as Window & { __researchGardenTools: Array<{ tool: { name: string }; signal: AbortSignal }> }).__researchGardenTools
    return registrations.filter(({ signal }) => !signal.aborted).map(({ tool }) => tool.name)
  })
  expect(activeAfterDisconnect).not.toContain('propose_harvest')
})
