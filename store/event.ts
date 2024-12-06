import { Module, VuexModule, Mutation, Action } from 'vuex-module-decorators';
import { $axios } from '@/utils/nuxt-instance';

@Module({
    name: 'event',
    stateFactory: true,
    namespaced: true,
})
export default class Event extends VuexModule {
    private eventList = [];
    private selectedEvent = null;
    private isLoading: boolean = false;

    public get $eventList() {
        return this.eventList;
    }

    public get $selectedEvent() {
        return this.selectedEvent;
    }

    public get $isLoading() {
        return this.isLoading;
    }

    @Mutation
    private SET_EVENT_LIST(data: any) {
        this.eventList = data.map((event: any) => ({
            ...event,
            location: `${event.address.street}, ${event.address.number} - ${event.address.neighborhood}, ${event.address.city.name} - ${event.address.city.state.name}`
        }));
    }

    @Mutation
    private SET_SELECTED_EVENT(data: any) {
        this.selectedEvent = data;
    }

    @Mutation
    private SET_IS_LOADING(value: boolean) {
        this.isLoading = value;
    }

    @Action
    public setLoading(value: boolean) {
        this.context.commit('SET_IS_LOADING', value);
    }

    @Action
    public setSelectedEvent(data: any) {
        this.context.commit('SET_SELECTED_EVENT', data);
    }

    @Action
    public async getAll() {

        this.setLoading(true);

        const preloads = [
            'rating',
            'tickets:status',
            'status',
            'address:city:state',
            'category',
            'attachments',
        ];

        return await $axios
            .$get(`events?orderBy[]=name:asc&${preloads.map((preload) => `preloads[]=${preload}`).join('&')}`)
            .then((response) => {
                if (response.body && response.body.code !== 'SEARCH_SUCCESS')
                    throw new Error(response);

                this.setLoading(false);
                this.context.commit('SET_EVENT_LIST', response.body.result.data);
                return response;
            })
            .catch(() => {
                this.setLoading(false);
                return {
                    data: 'Error',
                    code: 'FIND_NOTFOUND',
                    total: 0,
                };
            });
    }

    @Action
    public async getById(eventId: string) {

        this.setLoading(true);

        const preloads = [
            'rating',
            'tickets:status',
            'status',
            'address:city:state',
            'category',
            'attachments',
        ];


        return await $axios
            .$get(`events?where[id][v]=${eventId}&${preloads.map((preload) => `preloads[]=${preload}`).join('&')}`)
            .then((response) => {
                if (response.body && response.body.code !== 'SEARCH_SUCCESS')
                    throw new Error(response);

                this.setLoading(false);
                this.context.commit('SET_SELECTED_EVENT', response.body.result.data[0]);
                return response;
            })
            .catch(() => {
                this.setLoading(false);
                return {
                    data: 'Error',
                    code: 'FIND_NOTFOUND',
                    total: 0,
                };
            });
    }
}
