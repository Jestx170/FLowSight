// react-chartjs-2@5.3.1 ships a broken type barrel: its dist/index.d.ts
// re-exports from "../src/*", but the published tarball contains NO src/ — so
// `tsc` reports "no exported member 'Bar'" even though the runtime (dist/*.js)
// works fine. This is an upstream packaging bug, not a missing dependency, and
// no reinstall fixes it. The ambient declaration below restores the public API
// we use, typed against chart.js. Delete it if react-chartjs-2 is fixed/replaced.
import type { CanvasHTMLAttributes, MouseEvent, MutableRefObject, ReactNode } from "react";
import type {
  Chart as ChartJS,
  ChartType,
  ChartData,
  ChartOptions,
  DefaultDataPoint,
  InteractionItem,
  Plugin,
  UpdateMode,
} from "chart.js";

declare module "react-chartjs-2" {
  export type ChartJSOrUndefined<
    TType extends ChartType = ChartType,
    TData = DefaultDataPoint<TType>,
    TLabel = unknown,
  > = ChartJS<TType, TData, TLabel> | undefined;

  export type ForwardedRef<T> =
    | ((instance: T | null) => void)
    | MutableRefObject<T | null>
    | null;

  export interface ChartProps<
    TType extends ChartType = ChartType,
    TData = DefaultDataPoint<TType>,
    TLabel = unknown,
  > extends CanvasHTMLAttributes<HTMLCanvasElement> {
    type?: TType;
    data: ChartData<TType, TData, TLabel>;
    options?: ChartOptions<TType>;
    plugins?: Plugin<TType>[];
    fallbackContent?: ReactNode;
    redraw?: boolean;
    datasetIdKey?: string;
    updateMode?: UpdateMode;
  }

  export type TypedChartComponent<TDefaultType extends ChartType> = <
    TData = DefaultDataPoint<TDefaultType>,
    TLabel = unknown,
  >(
    props: Omit<ChartProps<TDefaultType, TData, TLabel>, "type"> & {
      ref?: ForwardedRef<ChartJSOrUndefined<TDefaultType, TData, TLabel>>;
    },
  ) => JSX.Element;

  export const Chart: <
    TType extends ChartType = ChartType,
    TData = DefaultDataPoint<TType>,
    TLabel = unknown,
  >(
    props: ChartProps<TType, TData, TLabel> & {
      ref?: ForwardedRef<ChartJSOrUndefined<TType, TData, TLabel>>;
    },
  ) => JSX.Element;

  export const Line: TypedChartComponent<"line">;
  export const Bar: TypedChartComponent<"bar">;
  export const Radar: TypedChartComponent<"radar">;
  export const Doughnut: TypedChartComponent<"doughnut">;
  export const PolarArea: TypedChartComponent<"polarArea">;
  export const Bubble: TypedChartComponent<"bubble">;
  export const Pie: TypedChartComponent<"pie">;
  export const Scatter: TypedChartComponent<"scatter">;

  export function getDatasetAtEvent(
    chart: ChartJS,
    event: MouseEvent<HTMLCanvasElement>,
  ): InteractionItem[];
  export function getElementAtEvent(
    chart: ChartJS,
    event: MouseEvent<HTMLCanvasElement>,
  ): InteractionItem[];
  export function getElementsAtEvent(
    chart: ChartJS,
    event: MouseEvent<HTMLCanvasElement>,
  ): InteractionItem[];
}
