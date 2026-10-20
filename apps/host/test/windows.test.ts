import { describe, expect, it } from 'vitest'
import { windowsChromePaths } from '../src/chrome.ts'
import { deniedPath } from '../src/shell.ts'
import { findPwsh7, PWSH_INSTALL_URL } from '../src/windows.ts'

const versions = (known: Record<string, number>) => async (path: string) => known[path]

describe('PowerShell 7 on Windows (v1.16 ticket 04, ob-e68m)', () => {
  it('takes the first candidate that runs version 7 or newer', async () => {
    const found = await findPwsh7(['C:\\old\\pwsh.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'D:\\other\\pwsh.exe'], versions({ 'C:\\old\\pwsh.exe': 6, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe': 7, 'D:\\other\\pwsh.exe': 8 }))
    expect(found).toEqual({ found: true, path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' })
  })

  it('says PowerShell 7 is missing, with the installer link, when no candidate runs', async () => {
    const found = await findPwsh7(['C:\\x\\pwsh.exe'], versions({}))
    expect(found.found).toBe(false)
    if (!found.found) {
      expect(found.problem).toContain('PowerShell 7 is not installed')
      expect(found.problem).toContain(PWSH_INSTALL_URL)
    }
  })

  it('names an older PowerShell that it found', async () => {
    const found = await findPwsh7(['C:\\x\\pwsh.exe'], versions({ 'C:\\x\\pwsh.exe': 5 }))
    expect(found.found ? '' : found.problem).toContain('C:\\x\\pwsh.exe is version 5')
  })

  it('reads the denied path from a PowerShell error', () => {
    expect(deniedPath("Set-Content: Access to the path 'C:\\Windows\\note.txt' is denied.")).toBe('C:\\Windows\\note.txt')
  })
})

describe('Chrome on Windows', () => {
  it('looks in the install directories of all users and of the one user', () => {
    expect(windowsChromePaths({ ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LocalAppData: 'C:\\Users\\a\\AppData\\Local' })).toEqual([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    ])
  })
})
