import { useMemo, type ComponentType } from 'react'
import type React from 'react'
import Highcharts from 'highcharts'
import HighchartsReactModule from 'highcharts-react-official'
import { CHART_PALETTE } from '@/config/chartPalette'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'

const HighchartsReact =
  ((HighchartsReactModule as unknown as { HighchartsReact?: ComponentType<HighchartsReactProps> }).HighchartsReact
    || (HighchartsReactModule as unknown as { default?: { HighchartsReact?: ComponentType<HighchartsReactProps> } }).default?.HighchartsReact
    || (HighchartsReactModule as unknown as { default?: ComponentType<HighchartsReactProps> }).default
    || HighchartsReactModule) as ComponentType<HighchartsReactProps>

type HighchartsReactProps = {
  highcharts: typeof Highcharts
  options: Highcharts.Options
  immutable?: boolean
  callback?: (chart: Highcharts.Chart) => void
  /** Props for the chart's container div, e.g. a fixed or percentage height so the chart fills its parent. */
  containerProps?: React.HTMLAttributes<HTMLDivElement>
}

type ThemedHighchartsProps = Omit<HighchartsReactProps, 'highcharts'>

export const ThemedHighcharts = ({ options, ...props }: ThemedHighchartsProps) => {
  const { mode } = useThemeMode()
  const { language } = useLanguage()

  const themedOptions = useMemo<Highcharts.Options>(() => {
    const isDark = mode === 'dark'
    const textColor = isDark ? '#e5e7eb' : '#374151'
    const mutedColor = isDark ? '#9ca3af' : '#6b7280'
    const gridColor = isDark ? 'rgba(156, 163, 175, .18)' : 'rgba(107, 114, 128, .14)'
    const themeAxis = <T extends Highcharts.XAxisOptions | Highcharts.YAxisOptions>(axis: T): T => ({
      gridLineColor: gridColor,
      lineColor: gridColor,
      tickColor: gridColor,
      ...axis,
      labels: {
        ...axis.labels,
        style: { color: mutedColor, ...axis.labels?.style },
      },
    })
    const themeAxes = <T extends Highcharts.XAxisOptions | Highcharts.YAxisOptions>(axes?: T | T[]) =>
      Array.isArray(axes) ? axes.map(themeAxis) : axes && themeAxis(axes)

    // Highcharts' defaults draw a white border round every bar and a white "contrast" outline round data labels,
    // which only look right on white. Bars get no border; pie slices are separated by the card colour instead;
    // labels use the theme text colour with no outline. A chart's own settings still win.
    const seriesOptions = (options.plotOptions?.series || {}) as Highcharts.PlotSeriesOptions & { dataLabels?: Highcharts.DataLabelsOptions | Highcharts.DataLabelsOptions[] }
    const ownLabels = Array.isArray(seriesOptions.dataLabels) ? undefined : seriesOptions.dataLabels
    const plotOptions: Highcharts.PlotOptions = {
      ...options.plotOptions,
      series: {
        ...seriesOptions,
        ...(Array.isArray(seriesOptions.dataLabels) ? {} : {
          dataLabels: {
            ...ownLabels,
            style: { color: textColor, textOutline: 'none', fontWeight: '600', ...ownLabels?.style },
          },
        }),
      } as Highcharts.PlotSeriesOptions,
      column: { borderWidth: 0, ...options.plotOptions?.column },
      bar: { borderWidth: 0, ...options.plotOptions?.bar },
      pie: { borderColor: isDark ? '#1b1e2a' : '#ffffff', ...options.plotOptions?.pie },
    }

    return {
      colors: CHART_PALETTE,
      lang: language === 'zu'
        ? { decimalPoint: ',', thousandsSep: ' ', loading: 'Kuyalayishwa...' }
        : { decimalPoint: '.', thousandsSep: ',', loading: 'Loading...' },
      ...options,
      chart: {
        backgroundColor: 'transparent',
        style: { color: textColor, fontFamily: 'Inter, system-ui, sans-serif' },
        ...options.chart,
      },
      title: { style: { color: textColor }, ...options.title },
      subtitle: { style: { color: mutedColor }, ...options.subtitle },
      legend: {
        itemStyle: { color: textColor },
        itemHoverStyle: { color: textColor },
        ...options.legend,
      },
      plotOptions,
      xAxis: themeAxes(options.xAxis),
      yAxis: themeAxes(options.yAxis),
      tooltip: {
        backgroundColor: isDark ? '#171923' : '#ffffff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        style: { color: textColor },
        ...options.tooltip,
      },
      credits: { enabled: false, ...options.credits },
    }
  }, [language, mode, options])

  return <HighchartsReact highcharts={Highcharts} options={themedOptions} {...props} />
}
