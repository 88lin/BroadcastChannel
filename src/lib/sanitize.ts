import sanitizeHtml from 'sanitize-html'
import { withChannel } from './channels'

const mediaTags = ['img', 'video', 'audio', 'source']
const interactiveTags = ['button', 'input', 'label']
const telegramTags = ['tg-spoiler']
const contentSanitizeOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(mediaTags, interactiveTags, telegramTags),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': [
      'aria-controls',
      'aria-hidden',
      'aria-label',
      'class',
      'id',
      'popover',
      'role',
      'style',
      'title',
    ],
    'a': ['href', 'name', 'target', 'rel', 'title', 'class'],
    'audio': ['src', 'controls', 'preload'],
    'button': ['type', 'class', 'popovertarget', 'popovertargetaction', 'aria-label'],
    'img': ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'class'],
    'input': ['type', 'id', 'class', 'aria-label', 'aria-controls'],
    'label': ['for', 'class'],
    'source': ['src', 'srcset', 'type'],
    'video': [
      'src',
      'width',
      'height',
      'poster',
      'controls',
      'preload',
      'muted',
      'autoplay',
      'loop',
      'playsinline',
      'webkit-playsinline',
      'disablepictureinpicture',
      'aria-label',
    ],
  },
  allowedStyles: {
    '*': {
      'background': [/^(?!.*javascript:)[^;]+$/i],
      'background-image': [/^url\((?!.*javascript:)[^)]+\)$/i],
      'background-position': [/^[\w\s.%+-]+$/],
      'background-size': [/^[\w\s.%+/-]+$/],
      'height': [/^\d+(?:\.\d+)?(?:px|%)$/],
      'padding-top': [/^\d+(?:\.\d+)?%$/],
      'width': [/^\d+(?:\.\d+)?(?:px|%)$/],
    },
  },
}

function getContentSanitizeOptions(channel: string) {
  return {
    ...contentSanitizeOptions,
    transformTags: {
      a: (tagName: string, attribs: Record<string, string>) => ({
        tagName,
        attribs: channel && attribs.href?.startsWith('/search/result?')
          ? { ...attribs, href: withChannel(attribs.href, channel) }
          : attribs,
      }),
    },
  }
}

export function sanitizeContentHtml(content: string, channel = ''): string {
  return sanitizeHtml(content, getContentSanitizeOptions(channel))
}

export function sanitizeFeedHtml(content: string, channel = ''): string {
  return sanitizeHtml(content, {
    ...getContentSanitizeOptions(channel),
    exclusiveFilter(frame) {
      return frame.tag === 'img' && frame.attribs.class?.includes('modal-img')
    },
  })
}
