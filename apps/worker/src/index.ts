export { Robot } from './robot/robot.ts'
export { Member } from './member/member.ts'
export { Home } from './home/home.ts'

export default {
  async fetch(): Promise<Response> {
    return new Response('Mr. Robot', { status: 200 })
  },
} satisfies ExportedHandler
