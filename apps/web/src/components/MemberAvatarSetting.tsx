import { useState } from 'react'
import * as Exit from 'effect/Exit'
import type { Me } from '@mr-robot/protocol'
import { keys, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { MemberFace } from './Avatar.tsx'
import { ColorPicker } from './ColorPicker.tsx'

/** The side of the square picture the app uploads (ux-s88l). */
const PICTURE_SIDE = 256

/** A picture the app made ready to upload, or why it could not. */
type PreparedPicture = { readonly ok: true; readonly bytes: Uint8Array; readonly type: string } | { readonly ok: false; readonly message: string }

/** Crop the picture to a centred square, scale it to 256 px, and encode it as WebP (PNG where the browser has no WebP). */
async function preparePicture(file: File): Promise<PreparedPicture> {
  try {
    const image = await createImageBitmap(file)
    const side = Math.min(image.width, image.height)
    const canvas = document.createElement('canvas')
    canvas.width = PICTURE_SIDE
    canvas.height = PICTURE_SIDE
    const context = canvas.getContext('2d')
    if (context === null) return { ok: false, message: 'this browser cannot prepare the picture' }
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, PICTURE_SIDE, PICTURE_SIDE)
    image.close()
    const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
    const webp = await encode('image/webp')
    const blob = webp !== null && webp.type === 'image/webp' ? webp : await encode('image/png')
    if (blob === null) return { ok: false, message: 'this browser cannot prepare the picture' }
    return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type }
  } catch {
    return { ok: false, message: 'this file is not a picture the app can read' }
  }
}

/** The Member's avatar in the You section (ux-2ft4, ux-s88l, ux-g4l9): a colour with initials, or a picture. */
export function MemberAvatarSetting({ me }: { me: Me }) {
  const command = useCommand()
  const [color, setColor] = useState(me.avatar.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const changed = [keys.me, keys.admin]
  const upload = async (file: File) => {
    setBusy(true)
    const picture = await preparePicture(file)
    const exit = picture.ok ? await command((api) => api.uploadAvatar(picture), changed) : undefined
    setError(picture.ok ? exitFailure(exit!) : picture.message)
    setBusy(false)
  }
  const remove = async () => {
    setBusy(true)
    setError(exitFailure(await command((api) => api.removeAvatar, changed)))
    setBusy(false)
  }
  const pick = async (next: string) => {
    setColor(next)
    const exit = await command((api) => api.updateMe({ avatarColor: next }), changed)
    setError(Exit.isSuccess(exit) ? undefined : exitFailure(exit))
  }
  return (
    <>
      <h3 className="panel-section">Avatar</h3>
      <div className="avatar-picker">
        <MemberFace memberId={me.id} name={me.name} avatar={{ ...me.avatar, color }} size={56} />
        <label className="button">
          {me.avatar.kind === 'picture' ? 'Change picture' : 'Upload picture'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) void upload(file) }} />
        </label>
        {me.avatar.kind === 'picture' ? <button type="button" className="link" disabled={busy} onClick={() => void remove()}>Remove picture</button> : null}
        {busy ? <span className="muted">Saving…</span> : error === undefined ? null : <span className="muted">{error}</span>}
      </div>
      <div className="muted">{me.avatar.kind === 'picture' ? 'The colour shows while the picture loads.' : 'Your initials on this colour. A picture is cut to a square.'}</div>
      <ColorPicker value={color} onChange={(next) => void pick(next)} />
    </>
  )
}
