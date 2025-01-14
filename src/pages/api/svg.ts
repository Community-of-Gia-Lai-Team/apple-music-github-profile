import fs from 'fs'
import path from 'path'

import type { NextApiHandler } from 'next'
import type { OptimizedSvg } from 'svgo'

import { prisma } from '../../context/prisma'
import { getMusicKitDeveloperToken } from '../../core/services/getMusicKitDeveloperToken'
import { getRecentlyPlayedTrack } from '../../modules/music/services/getRecentlyPlayedTrack'
import { getAlbumCover } from '../../modules/music/services/getAlbumCover'

interface UserQuery {
  theme?: string
  uid?: string
}

const api: NextApiHandler = async (req, res) => {
  const { theme, uid } = req.query as UserQuery

  const requiredParams = ['theme', 'uid']

  if (Object.keys(req.query).some(key => !requiredParams.includes(key))) {
    return res.status(400).send('params exceed')
  } else if (typeof theme !== 'string' || typeof uid !== 'string') {
    return res.status(400).send('illegal query')
  }

  /**
   * make sure template file exists
   */
  const targetTemplateFile = path.join(
    process.cwd(),
    'src/templates',
    `${theme}.ejs`
  )
  if (!fs.existsSync(targetTemplateFile)) {
    return res.status(400).send('no template')
  }

  /**
   * Locate user apple music token
   */
  const targetUser = await prisma.user.findUnique({
    where: {
      uid: uid,
    },
  })

  if (!targetUser) {
    return res.status(400).send('user not found')
  } else if (typeof targetUser.appleMusicToken !== 'string') {
    return res.status(400).send('not connected')
  }

  /**
   * Get all tokens
   */
  const userToken = targetUser.appleMusicToken
  const developerToken = getMusicKitDeveloperToken(60)

  /**
   * Find recently played track
   */
  const track = await getRecentlyPlayedTrack(developerToken, userToken)

  /**
   * Build metadatas
   */
  const part = 3
  const getDuration = (millisec: number) => {
    let minute = Math.floor(millisec / (60 * 1000))
    let seconds = Math.ceil((millisec - minute * 60 * 1000) / 1000)

    return `${minute}:${seconds.toString().padStart(2, '0')}`
  }

  const [templateFile, coverImageData] = await Promise.all([
    fs.promises.readFile(targetTemplateFile, 'utf-8'),
    getAlbumCover(track.attributes.artwork),
  ])

  const { default: ejs } = await import('ejs')
  const builtRenderedData = {
    title: track.attributes.name,
    artist: track.attributes.artistName ?? '',
    coverImageData,
    timestamp: {
      percentage: (100 / part).toFixed(2),
      elapsed: getDuration(track.attributes.durationInMillis / part),
      remaining: getDuration(
        (track.attributes.durationInMillis * (part - 1)) / part
      ),
    },
  }

  res.setHeader('Content-Type', 'image/svg+xml')

  if (process.env.NODE_ENV === 'production') {
    /**
     * Store in local browser for 60 seconds
     * Stored cache on server is fresh for 128 seconds
     * After that, cache on server still serveable for 31 days but it will trigger for a fresh update
     */
    res.setHeader(
      'Cache-Control',
      `public, max-age=60, s-maxage=128, stale-while-revalidate=${
        60 * 60 * 24 * 31
      }`
    )
  }

  const { optimize } = await import('svgo')
  res.send(
    (optimize(ejs.render(templateFile, builtRenderedData)) as OptimizedSvg).data
  )
}

export default api
