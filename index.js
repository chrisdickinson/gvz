'use strict'

module.exports = renderer

const bresenham = require('bresenham/generator')
const colors = require('ansi-256-colors')
const colorScale = require('d3-scale')

// x = series idx flag
// y = edge or fill or both
//                  xxxxxxyy
const MARK_EDGE = 0b00000001
const MARK_FILL = 0b00000010

function avg (collected) {
  return collected.reduce((acc, xs) => {
    return acc + xs[1]
  }, 0) / collected.length
}

function renderer (series, options) {
  options = Object.assign({
    stack: false,
    height: 10,
    width: 10,
    timeseries: false,
    fill: true,
    edge: false,
    aggregate: avg
  }, options || {})

  const dims = [
    options.width,
    options.height
  ]

  // half the available rows, times 4
  const rows = (dims[1]) << 2
  // all of the available columns, times 2
  const cols = dims[0] << 1

  const xDomain = [0, cols]
  const yDomain = [0, rows]

  // this isn't where this abstraction should live! but whatever!
  if (options.timeseries) {
    const min = getMin(series.map(xs => getMin(xs.map(ys => ys[0]))))
    const max = getMax(series.map(xs => getMax(xs.map(ys => ys[0]))))
    const step = (max - min) / cols
    series = series.map(xs => {
      return normalizeTimeseries(xs, min, max, step, options.aggregate)
    })
  }
  const xRange = [0, getMin(series.map(xs => xs.length))]

  if (options.stack) {
    for (var i = 1; i < series.length; ++i) {
      series[i] = series[i].slice()
      for (var j = 0; j < xRange[1]; ++j) {
        series[i][j] += series[i - 1][j]
      }
    }
  }

  const yRange = [getMin(series.map(getMin)), getMax(series.map(getMax))]

  const seriesColors = colorScale.scaleOrdinal([
    [[0, 2, 1], [0, 4, 3]],
    [[4, 2, 6], [5, 2, 6]],
    [[4, 2, 1], [5, 4, 2]],
    [[2, 1, 0], [4, 3, 0]],
    [[0, 1, 2], [0, 3, 4]]
  ])

  const rawBuf = new Uint8Array(rows * cols)
  series.map((arr, seriesIdx) => {
    for (var i = 1; i < arr.length; ++i) {
      const x0 = rangeToDomain(i - 1, xRange, xDomain) | 0
      const y0 = rangeToDomain(arr[i - 1], yRange, yDomain) | 0

      const x1 = rangeToDomain(i, xRange, xDomain) | 0
      const y1 = rangeToDomain(arr[i], yRange, yDomain) | 0

      for (const xs of bresenham(x0, y0, x1, y1)) {
        rawBuf[((xs.y * cols) + xs.x) | 0] |= MARK_EDGE | (1 << (seriesIdx + 2))

        if (!options.fill) {
          continue
        }

        for (var j = xs.y - 1; j > -1; --j) {
          if (rawBuf[((j * cols) + xs.x) | 0] & MARK_EDGE) {
            break
          }
          rawBuf[((j * cols) + xs.x) | 0] |= MARK_FILL | (1 << (seriesIdx + 2))
        }
      }
    }
  })

  const output = []
  const xStride = 2
  const yStride = 4
  for (var y = rows - yStride; y > -yStride; y -= yStride) {
    const yOffs0 = y * cols
    const yOffs1 = yOffs0 + cols
    const yOffs2 = yOffs1 + cols
    const yOffs3 = yOffs2 + cols
    for (var x = 0; x < cols; x += xStride) {
      /*
        1 4   -> 87654321
        2 5
        3 6
        7 8
      */
      const xOff0 = x
      const xOff1 = xOff0 + 1

      const dot_1 = rawBuf[yOffs3 + xOff0]
      const dot_2 = rawBuf[yOffs2 + xOff0]
      const dot_3 = rawBuf[yOffs1 + xOff0]
      const dot_7 = rawBuf[yOffs0 + xOff0]

      const dot_4 = rawBuf[yOffs3 + xOff1]
      const dot_5 = rawBuf[yOffs2 + xOff1]
      const dot_6 = rawBuf[yOffs1 + xOff1]
      const dot_8 = rawBuf[yOffs0 + xOff1]

      const together = (
        dot_1 |
        dot_2 |
        dot_3 |
        dot_4 |
        dot_5 |
        dot_6 |
        dot_7 |
        dot_8
      )
      const isEdge = !options.edge ? false : together & MARK_EDGE

      const isXMarker = ((x / xStride) & 7) === 0
      const isYMarker = ((y / yStride) & 3) === 0

      const buildChar = (
        (Boolean(dot_1 & 0b11) << 0) |
        (Boolean(dot_2 & 0b11) << 1) |
        (Boolean(dot_3 & 0b11) << 2) |
        (Boolean(dot_4 & 0b11) << 3) |
        (Boolean(dot_5 & 0b11) << 4) |
        (Boolean(dot_6 & 0b11) << 5) |
        (Boolean(dot_7 & 0b11) << 6) |
        (Boolean(dot_8 & 0b11) << 7)
      )

      const character = String.fromCodePoint(buildChar | 0x2800)

      const useColors = [0, 0, 0]
      var seriesPresent = (together >> 2) & 0b111111
      var idx = 0
      while (seriesPresent) {
        if (seriesPresent & 1) {
          const using = seriesColors(idx)
          useColors[0] = using[isEdge ? 0 : 1][0]
          useColors[1] = using[isEdge ? 0 : 1][1]
          useColors[2] = using[isEdge ? 0 : 1][2]
        }
        ++idx
        seriesPresent >>>= 1
      }

      useColors[0] = Math.min(6, useColors[0])
      useColors[1] = Math.min(6, useColors[1])
      useColors[2] = Math.min(6, useColors[2])

      /* eslint-disable operator-linebreak */
      output.push(
        buildChar === 0
        ? colors.fg.grayscale[1] + (
          isXMarker && isYMarker ? '+' : // ⣇ ·
          isXMarker ? ' ' : // ⡇
          isYMarker ? '-' : // ⣀
          ' '
        ) : colors.fg.getRgb(
          useColors[0],
          useColors[1],
          useColors[2]
        ) + character
      )
      /* eslint-enable operator-linebreak */
    }
    output.push(colors.reset + '\n')
  }

  return output.join('')
}

function rangeToDomain (input, range, domain) {
  return ((input - range[0]) / (range[1] - range[0])) * (domain[1] - domain[0])
}

function getMin (arr) {
  return arr.reduce((min, xs) => {
    return min < xs ? min : xs
  }, Infinity)
}

function getMax (arr) {
  return arr.reduce((max, xs) => {
    return max > xs ? max : xs
  }, -Infinity)
}

function normalizeTimeseries (ts, min, max, step, agg) {
  var idx = 0
  var time = min
  const output = []

  while (time < max) {
    const collected = []
    for (var i = idx; ts[i] && ts[i][0] < time + step; ++i) {
      collected.push(ts[i])
    }
    if (!collected.length) {
      // synthesize a single point
      const last = idx === 0 ? [time, 0] : ts[idx - 1]
      const next = idx >= ts.length ? [time, 0] : ts[idx]

      collected.push([
        time,
        (next[1] - last[1]) * ((time - last[0]) / (next[0] - last[0]))
      ])
    }
    idx = i

    output.push(
      collected.length === 1
      ? collected[0][1]
      : agg(collected)
    )

    time += step
  }

  return output
}
