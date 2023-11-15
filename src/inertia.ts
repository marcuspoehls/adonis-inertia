/*
 * @adonisjs/inertia
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/// <reference types="@adonisjs/core/providers/edge_provider" />

import type { HttpContext } from '@adonisjs/core/http'
import type { InertiaConfig, MaybePromise, PageProps, AssetsVersion } from './types.js'

/**
 * Main class used to interact with Inertia
 */
export class Inertia {
  /**
   * The name of the Edge view that will be used to render the page.
   */
  #edgeRootView: string

  /**
   * Symbol used to identify lazy props
   */
  #kLazySymbol = Symbol('lazy')

  constructor(
    protected ctx: HttpContext,
    protected config: InertiaConfig = {},
    protected version: AssetsVersion
  ) {
    this.#edgeRootView = config.rootView || 'root'
  }

  /**
   * Check if a value is a lazy prop
   */
  #isLazyProps(value: any) {
    return typeof value === 'object' && value && this.#kLazySymbol in value
  }

  /**
   * Pick props to resolve based on x-inertia-partial-data header
   *
   * If header is not present, resolve all props except lazy props
   * If header is present, resolve only the props that are listed in the header
   */
  #pickPropsToResolve(component: string, props: PageProps) {
    const partialData = this.ctx.request
      .header('x-inertia-partial-data')
      ?.split(',')
      .filter(Boolean)

    const partialComponent = this.ctx.request.header('x-inertia-partial-component')

    let entriesToResolve = Object.entries(props)
    if (partialData && partialComponent === component) {
      entriesToResolve = entriesToResolve.filter(([key]) => partialData.includes(key))
    } else {
      entriesToResolve = entriesToResolve.filter(([key]) => !this.#isLazyProps(props[key]))
    }

    return entriesToResolve
  }

  /**
   * Resolve the props that will be sent to the client
   */
  async #resolvePageProps(component: string, props: PageProps) {
    const entriesToResolve = this.#pickPropsToResolve(component, props)

    const entries = entriesToResolve.map(async ([key, value]) => {
      if (typeof value === 'function') {
        return [key, await value(this.ctx)]
      }

      if (this.#isLazyProps(value)) {
        const lazyValue = (value as any)[this.#kLazySymbol]
        return [key, await lazyValue()]
      }

      return [key, value]
    })

    return Object.fromEntries(await Promise.all(entries))
  }

  /**
   * Build the page object that will be returned to the client
   *
   * See https://inertiajs.com/the-protocol#the-page-object
   */
  async #buildPageObject(component: string, pageProps?: PageProps) {
    return {
      component,
      version: this.version,
      props: await this.#resolvePageProps(component, { ...this.config.sharedData, ...pageProps }),
      url: this.ctx.request.url(true),
    }
  }

  /**
   * Render a page using Inertia
   */
  async render(component: string, pageProps?: PageProps) {
    const pageObject = await this.#buildPageObject(component, pageProps)
    const isInertiaRequest = !!this.ctx.request.header('x-inertia')

    if (!isInertiaRequest) {
      return this.ctx.view.render(this.#edgeRootView, { page: pageObject })
    }

    return pageObject
  }

  /**
   * Create a lazy prop
   *
   * Lazy props are never resolved on first visit, but only when the client
   * request a partial reload explicitely with this value.
   *
   * See https://inertiajs.com/partial-reloads#lazy-data-evaluation
   */
  lazy(callback: () => MaybePromise<any>) {
    return { [this.#kLazySymbol]: callback }
  }

  /**
   * This method can be used to redirect the user to an external website
   * or even a non-inertia route of your application.
   *
   * See https://inertiajs.com/redirects#external-redirects
   */
  async location(url: string) {
    this.ctx.response.header('X-Inertia-Location', url)
    this.ctx.response.status(409)
  }
}