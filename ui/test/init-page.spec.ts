import { expect, test } from '@playwright/test'

test.describe('Init page', () => {
  test('renders onboarding controls', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Connect to Kubernetes Cluster.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect to Cluster' })).toBeVisible()
    await expect(page.getByText('Auto-Detected Configs')).toBeVisible()
  })
})